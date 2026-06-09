// Reports money helpers. Rates are NO LONGER hardcoded here — they live per
// cafeteria, per meal, effective-dated in the DB (table cafeteria_meal_prices) and
// are summed server-side using each punch's day-correct rate. This module only
// shapes/formats the Employee Paid / Company Paid / Vendor figures the API returns.
// Money appears ONLY in Reports; the dashboard/live views stay count-only.
export type MealCost = { emp: number; co: number; vendor: number };

// Build a cost from the two stored rates the server returns. Vendor is always the
// sum of Employee Paid + Company Paid (the third value is never stored independently).
export const costOf = (emp_paid?: number | null, company_paid?: number | null): MealCost => {
  const emp = emp_paid ?? 0;
  const co = company_paid ?? 0;
  return { emp, co, vendor: emp + co };
};

export const addCost = (a: MealCost, b: MealCost): MealCost => ({
  emp: a.emp + b.emp,
  co: a.co + b.co,
  vendor: a.vendor + b.vendor,
});

export const ZERO_COST: MealCost = { emp: 0, co: 0, vendor: 0 };

// ₹ with Indian digit grouping, up to 2 decimals (rates can carry .5).
export const rupee = (n: number): string =>
  "₹" + (n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
