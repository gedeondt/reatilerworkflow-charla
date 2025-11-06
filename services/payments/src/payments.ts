export type Address = {
  line1: string;
  city: string;
  zip: string;
  country: string;
};

export type PaymentRecord = {
  paymentId: string;
  orderId: string;
  amount: number;
  address: Address;
  reservationId: string;
  status: 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
};

export type PaymentStore = {
  create: (payment: PaymentRecord) => PaymentRecord;
  findByOrderId: (orderId: string) => PaymentRecord | null;
  updateStatus: (orderId: string, status: PaymentRecord['status']) => PaymentRecord | null;
};

export function createPaymentStore(): PaymentStore {
  const payments = new Map<string, PaymentRecord>();
  const orderToPayment = new Map<string, string>();

  const create = (payment: PaymentRecord): PaymentRecord => {
    payments.set(payment.paymentId, payment);
    orderToPayment.set(payment.orderId, payment.paymentId);
    return payment;
  };

  const findByOrderId = (orderId: string): PaymentRecord | null => {
    const paymentId = orderToPayment.get(orderId);
    if (!paymentId) {
      return null;
    }

    return payments.get(paymentId) ?? null;
  };

  const updateStatus = (
    orderId: string,
    status: PaymentRecord['status']
  ): PaymentRecord | null => {
    const paymentId = orderToPayment.get(orderId);
    if (!paymentId) {
      return null;
    }

    const current = payments.get(paymentId);
    if (!current) {
      return null;
    }

    if (current.status === status) {
      return current;
    }

    const updated: PaymentRecord = { ...current, status };
    payments.set(paymentId, updated);
    return updated;
  };

  return {
    create,
    findByOrderId,
    updateStatus
  };
}
