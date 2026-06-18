// ─── Product Types ────────────────────────────────────────────────────────────

export interface Category {
  id: number
  name: string
  slug: string
  emoji?: string | null
  description: string | null
  image_url: string | null
  is_active: boolean
  sort_order?: number | null
}

export interface State {
  id: string
  name: string
  slug: string         // same as id in admin
  description: string | null
  image_url: string | null  // mapped from image_path
  image_path?: string | null
  region: string | null
  is_active?: boolean
  // flag_emoji does NOT exist in DB — removed
}

// BUG FIX (code quality): previously this shape differed from the one in
// src/lib/storeData.ts (which has variant_value, no sku/cost_price) causing
// fetchProductData callbacks to use `any` to avoid type errors.
// Unified here to match the actual DB schema.
export interface ProductVariant {
  id: number
  product_id: number
  /** Normalised size label — populated from variant_value / size / variant_label */
  size: string
  sku?: string | null
  price: number
  mrp: number | null
  cost_price?: number | null
  available_stock: number
  is_active: boolean
  variant_value?: string | null
  sort_order?: number | null
}

export interface Product {
  id: number
  name: string
  slug: string
  emoji: string | null
  sku: string | null
  category_id: number
  state_id: string | null
  is_active: boolean
  status?: 'active' | 'inactive' | 'draft' // legacy, use is_active
  unit_label: string | null
  gst_rate: number
  price: number           // base selling price
  selling: number | null
  mrp: number | null
  cost_price: number | null
  available_stock: number
  initial_stock: number
  short_description: string | null
  long_description: string | null
  image_url: string | null
  tags: string | null
  badges_bestseller: boolean
  badges_organic: boolean
  badges_new: boolean
  is_deleted: boolean
  created_at: string
  // AI content fields
  ai_description: string | null
  ai_health_benefits: string | null   // JSON array string
  ai_how_to_use: string | null        // JSON array string
  ai_storage_tips: string | null      // JSON array string
  ai_who_should_buy: string | null
  ai_generated_at: string | null
  // Fields present in DB / normalised shape but previously accessed via (product as any)
  badges?: string[]            // badge slugs array e.g. ['bestseller', 'organic']
  region?: string | null       // state/region display name
  unit?: string | null         // alternative unit label
  card_bg?: string | null      // card background colour
  review_count?: number | null // real DB review count (replaces fake deterministic value)
  // Relations (when joined)
  categories?: Category
  states?: State
  product_variants?: ProductVariant[]
  product_images?: ProductImage[]
}

export interface ProductImage {
  id: string
  product_id: string
  url: string
  sort_order: number
  alt_text: string | null
}

// ─── Cart Types ───────────────────────────────────────────────────────────────

export interface CartItem {
  productId: string
  variantId: string
  name: string
  slug: string
  image: string | null
  emoji: string | null
  size: string
  price: number
  mrp: number
  gstRate: number
  qty: number
  maxQty: number      // stock limit
  // Product badge flags — driven from DB, not hardcoded
  isOrganic:    boolean
  isHimalayan:  boolean
  isBestseller: boolean
}

export interface AppliedCoupon {
  code: string
  discount: number    // absolute ₹ amount
  type: 'flat' | 'percent'
  percent?: number
}

// ─── Order Types ──────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'pending'
  | 'pending_payment'
  | 'confirmed'
  | 'packed'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'return_requested'
  | 'returned'
  | 'refunded'

export interface OrderAddress {
  name: string
  phone: string
  flat: string
  area: string
  city: string
  state: string
  pincode: string
  // Required — always initialised to 'Home' as the safe default.
  // Was optional (`?`) but every code path sets it; making it required
  // surfaces any accidental omission at the type level and prevents the
  // payload field from being `undefined` when sent to the orders API.
  label: 'Home' | 'Office' | 'Parents' | 'Friends' | 'Others'
}

export interface OrderItem {
  id: number
  order_id: number
  product_id: number | string
  variant_id: number | string | null
  quantity: number
  price_at_time: number    // real column name
  created_at: string
}

// Address stored in customers table (not orders)
export interface CustomerAddress {
  flat:    string
  area:    string
  city:    string
  state:   string
  pincode: string
  label?:  string
}

export interface Order {
  id: number
  order_number: string
  customer_id: number | null
  order_status: OrderStatus
  payment_method: 'razorpay' | 'cod' | 'razorpay_online'
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded'
  payment_id: string | null          // stores razorpay order/payment id
  subtotal: number
  coupon_discount: number
  shipping_charge: number
  tax: number
  total_amount: number
  coupon_code: string | null
  idempotency_key: string | null
  shipping_address: {         // JSONB column in orders table
    name: string; phone: string
    flat: string; area: string; city: string; state: string; pincode: string
    label?: string
  } | null
  tracking_number: string | null
  courier: string | null
  shipped_at: string | null
  delivered_at: string | null
  created_at: string
  updated_at: string | null
  order_items?: OrderItem[]
}

// ─── Review Types ─────────────────────────────────────────────────────────────

export interface Review {
  id: string
  product_id: string
  customer_name: string
  location: string | null
  rating: number          // 1-5, default 5
  review_text: string | null
  comment: string | null  // added by migration, same as review_text
  status: string          // 'approved' | 'pending'
  is_approved?: boolean   // computed column added by migration
  created_at: string
}

// ─── Site Settings Type ───────────────────────────────────────────────────────

export interface SiteSettings {
  // Store control
  store_open: string                    // 'true' | 'false'
  maintenance_message: string

  // Header bars
  ann_hide: string                      // 'true' | 'false'
  ann_text: string
  ticker_hide: string
  ticker_1_text: string
  ticker_2_text: string
  ticker_3_text: string
  ticker_4_text: string
  ticker_5_text: string
  ticker_1_hide: string
  ticker_2_hide: string
  ticker_3_hide: string
  ticker_4_hide: string
  ticker_5_hide: string

  // Shipping
  free_shipping_min: string             // number as string e.g. '799'
  flat_shipping_charge: string

  // Contact
  whatsapp_number: string
  contact_email: string
  contact_phone: string
  contact_address: string

  // Social
  instagram_url: string
  facebook_url: string
  youtube_url: string

  // Email
  order_email_enabled: string
  admin_notify_email: string

  // Section visibility toggles
  show_trust_bar: string
  show_best_sellers: string
  show_new_arrivals: string
  show_state_stories: string
  show_reviews_section: string
  show_newsletter_bar: string
  show_blog_section: string
  show_wishlist: string
  show_reviews_on_pdp: string
  show_related_products: string
  show_track_order_page: string
  show_blog: string
  catalogue_visible: string
  featured_collection_slug: string

  // Checkout settings
  prepaid_discount_pct: string          // number as string e.g. '5'
  cod_enabled: string
  cod_max_value: string                 // max COD order value e.g. '3000'
  cod_max_active_orders: string         // fraud: max active COD orders per phone
  min_order_amount: string              // minimum cart value to allow checkout e.g. '199'
  upi_enabled: string                   // 'true' | 'false' — gates Razorpay UPI in checkout

  // Loyalty / coins programme
  loyalty_enabled: string               // 'true' | 'false'
  loyalty_points_per_rupee: string      // coins earned per ₹ spent e.g. '1'
  loyalty_points_value: string          // ₹ value of 1 coin e.g. '0.25'
  loyalty_points_label: string          // display name e.g. 'Pahadi Coins'
  loyalty_min_redeem: string            // minimum coins to redeem per order e.g. '40'
  loyalty_max_redeem_pct: string        // max % of order value redeemable e.g. '20'

  // Cart reviews (CMS-controlled)
  review_1_name: string
  review_1_location: string
  review_1_text: string
  review_2_name: string
  review_2_location: string
  review_2_text: string
  review_3_name: string
  review_3_location: string
  review_3_text: string

  // Allow arbitrary additional keys
  [key: string]: string
}

// ─── Upsell Types ─────────────────────────────────────────────────────────────

export interface UpsellItem {
  id:           string
  productId:    string
  name:         string
  slug:         string
  size:         string
  price:        number
  mrp:          number
  emoji:        string | null
  image:        string | null
  gstRate:      number
  maxQty:       number
  badge:        string | null
  isOrganic:    boolean
  isHimalayan:  boolean
  isBestseller: boolean
}

// ─── Address Types ────────────────────────────────────────────────────────────

export type AddressLabel = 'Home' | 'Office' | 'Parents' | 'Friends' | 'Others'

export interface SavedAddress extends OrderAddress {
  id: string
  is_default: boolean
  // Legacy field aliases present in addresses saved by the old site
  addr?: string    // old name for flat/address_line1
  pin?: string     // old name for pincode
}

/** Raw profile object returned by /api/v1/profile or the profile cache. */
export interface RawProfile {
  first_name:       string | null
  last_name:        string | null
  phone:            string | null
  email:            string | null
  address_line1:    string | null
  address_line2?:   string | null
  city?:            string | null
  state?:           string | null
  pincode?:         string | null
  saved_addresses?: string | null   // JSON-stringified SavedAddress[]
}
