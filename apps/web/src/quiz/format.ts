/** Points the French way: 1,5 rather than 1.5. */
export const formatPoints = (n: number): string => String(n).replace('.', ',');

/** Answering speed as shown in the chip: ×1,5 (one decimal, decimal comma). */
export const formatRate = (rate: number): string => `×${rate.toFixed(1).replace('.', ',')}`;
