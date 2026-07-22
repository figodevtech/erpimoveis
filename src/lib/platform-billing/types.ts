export type PlatformCharge = {
  id: string;
  competence: string;
  charge_type: "MONTHLY" | "EXTRA";
  description: string;
  due_date: string;
  amount_cents: number;
  status: "PENDING" | "PAID" | "OVERDUE" | "CANCELED" | "REFUNDED" | "ERROR";
  paid_at: string | null;
  received_amount_cents: number | null;
  gateway: string;
  checkout_url: string | null;
  bank_slip_url: string | null;
  identification_field: string | null;
  pix_copy_paste: string | null;
};

export type PlatformSubscription = {
  company: { name: string | null; billingEmail: string | null };
  subscription: {
    status: "ACTIVE" | "PAST_DUE" | "BLOCKED" | "CANCELED";
    monthlyAmountCents: number;
    billingDay: number;
    paidThrough: string | null;
    gateway: string;
  };
  access: {
    allowed: boolean;
    showBanner: boolean;
    lateDays: number;
    blockAt: string | null;
    message: string | null;
  };
  charges: PlatformCharge[];
  synchronizedAt: string;
};

export type PlatformBillingResult = {
  configured: boolean;
  stale: boolean;
  data: PlatformSubscription | null;
  error?: string;
};
