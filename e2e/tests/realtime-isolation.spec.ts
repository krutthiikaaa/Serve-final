import { expect, test } from '@playwright/test';
import type { OrderEventData, StaffOrder, StudentOrder } from '@serve/contracts';
import { StudentActor, adminActor, approvedStaff } from './support/api';

const settle = () => new Promise((r) => setTimeout(r, 1500));

/** Rooms are assigned by the server; nobody sees events for another canteen or another student. */
test('order events reach only the right staff, student and admins', async () => {
  const kg = await approvedStaff('KG Staff', 'Krishna & Godavari Night Canteen');
  const ved = await approvedStaff('Vedavathi Staff', 'Vedavathi Night Canteen');
  const buyer = await StudentActor.register('Buyer');
  const bystander = await StudentActor.register('Bystander');
  const admin = await adminActor();

  const [kgSocket, vedSocket, buyerSocket, bystanderSocket, adminSocket] = await Promise.all([
    kg.staff.socket(),
    ved.staff.socket(),
    buyer.socket(),
    bystander.socket(),
    admin.socket(),
  ]);

  // A malicious client tries to join another canteen's room by name: the server ignores it.
  vedSocket.socket.emit('join', `canteen:${kg.canteen.id}`);
  vedSocket.socket.emit('subscribe', { room: `canteen:${kg.canteen.id}` });
  // A public menu subscription never carries orders.
  expect((await bystanderSocket.subscribeMenu(kg.canteen.id)).ok).toBe(true);

  const { order } = await buyer.orderAndPay(1);

  const staffView = await kgSocket.waitFor<OrderEventData<StaffOrder>>(
    'order.payment_confirmed',
    (d) => d.order.id === order.id,
  );
  expect(staffView.order.student.name).toBe('Buyer');
  await adminSocket.waitFor<OrderEventData<StaffOrder>>(
    'order.payment_confirmed',
    (d) => d.order.id === order.id,
  );
  const studentView = await buyerSocket.waitFor<OrderEventData<StudentOrder>>(
    'order.payment_confirmed',
    (d) => d.order.id === order.id,
  );
  expect(studentView.order).not.toHaveProperty('student');

  await kg.staff.data('PATCH', `/staff/orders/${order.id}/status`, { status: 'PREPARING' });
  await buyerSocket.waitFor('order.preparing');
  await settle();

  const leaked = (s: typeof vedSocket) =>
    s.events.filter((e) => e.type.startsWith('order.')).map((e) => e.type);
  expect(leaked(vedSocket)).toEqual([]);
  expect(leaked(bystanderSocket)).toEqual([]);

  // Cross-canteen REST access is refused too (404, not someone else's order).
  const foreign = await ved.staff.call('GET', `/staff/orders/${order.id}`);
  expect(foreign.status).toBe(404);
  const otherStudent = await bystander.call('GET', `/orders/${order.id}`);
  expect(otherStudent.status).toBe(404);

  for (const s of [kgSocket, vedSocket, buyerSocket, bystanderSocket, adminSocket]) s.close();
});
