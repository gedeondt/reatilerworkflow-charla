import type { z } from 'zod';

import { ReservationItem } from './http/schemas.js';

export type ReservationItemValue = z.infer<typeof ReservationItem>;

export type Address = {
  line1: string;
  city: string;
  zip: string;
  country: string;
};

export type ReservationRecord = {
  reservationId: string;
  orderId: string;
  items: ReservationItemValue[];
  amount: number;
  address: Address;
  status: 'RESERVED' | 'COMMITTED' | 'RELEASED' | 'FAILED';
};

export type ReservationStore = {
  create: (reservation: ReservationRecord) => ReservationRecord;
  findByOrderId: (orderId: string) => ReservationRecord | null;
  findByReservationId: (reservationId: string) => ReservationRecord | null;
  updateStatus: (
    reservationId: string,
    status: ReservationRecord['status']
  ) => ReservationRecord | null;
};

export function createReservationStore(): ReservationStore {
  const reservations = new Map<string, ReservationRecord>();
  const orderToReservation = new Map<string, string>();

  const create = (reservation: ReservationRecord): ReservationRecord => {
    reservations.set(reservation.reservationId, reservation);
    orderToReservation.set(reservation.orderId, reservation.reservationId);
    return reservation;
  };

  const findByOrderId = (orderId: string): ReservationRecord | null => {
    const reservationId = orderToReservation.get(orderId);
    if (!reservationId) {
      return null;
    }

    return reservations.get(reservationId) ?? null;
  };

  const findByReservationId = (reservationId: string): ReservationRecord | null => {
    return reservations.get(reservationId) ?? null;
  };

  const updateStatus = (
    reservationId: string,
    status: ReservationRecord['status']
  ): ReservationRecord | null => {
    const current = reservations.get(reservationId);
    if (!current) {
      return null;
    }

    if (current.status === status) {
      return current;
    }

    const updated: ReservationRecord = { ...current, status };
    reservations.set(reservationId, updated);
    return updated;
  };

  return {
    create,
    findByOrderId,
    findByReservationId,
    updateStatus
  };
}
