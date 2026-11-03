// One limit for "how many of one item": the order and cart-validation schemas accept 1..MAX_LINE_QTY per line. The cart used to allow up to 99
// (its fallback when the stock cap is unknown, e.g. after a reload), so a customer could build a cart that the server then refused with the cryptic
// "Invalid request" — at validation and at Place Order.
export const MAX_LINE_QTY = 50
