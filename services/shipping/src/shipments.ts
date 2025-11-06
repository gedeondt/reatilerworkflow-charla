export type Address = {
  line1: string;
  city: string;
  zip: string;
  country: string;
};

export type ShipmentRecord = {
  shipmentId: string;
  orderId: string;
  address: Address;
  status: 'PREPARED' | 'DISPATCHED' | 'FAILED';
};

export type ShipmentStore = {
  create: (shipment: ShipmentRecord) => ShipmentRecord;
  findByOrderId: (orderId: string) => ShipmentRecord | null;
  updateStatus: (orderId: string, status: ShipmentRecord['status']) => ShipmentRecord | null;
};

export function createShipmentStore(): ShipmentStore {
  const shipments = new Map<string, ShipmentRecord>();
  const orderToShipment = new Map<string, string>();

  const create = (shipment: ShipmentRecord): ShipmentRecord => {
    shipments.set(shipment.shipmentId, shipment);
    orderToShipment.set(shipment.orderId, shipment.shipmentId);
    return shipment;
  };

  const findByOrderId = (orderId: string): ShipmentRecord | null => {
    const shipmentId = orderToShipment.get(orderId);
    if (!shipmentId) {
      return null;
    }

    return shipments.get(shipmentId) ?? null;
  };

  const updateStatus = (
    orderId: string,
    status: ShipmentRecord['status']
  ): ShipmentRecord | null => {
    const shipmentId = orderToShipment.get(orderId);
    if (!shipmentId) {
      return null;
    }

    const current = shipments.get(shipmentId);
    if (!current) {
      return null;
    }

    if (current.status === status) {
      return current;
    }

    const updated: ShipmentRecord = { ...current, status };
    shipments.set(shipmentId, updated);
    return updated;
  };

  return {
    create,
    findByOrderId,
    updateStatus
  };
}
