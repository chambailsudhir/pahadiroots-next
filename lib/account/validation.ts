// ─────────────────────────────────────────────────────────────
// Validation helpers — reusable across all account forms
// ─────────────────────────────────────────────────────────────

export const validate = {
  phone:    (p: string) => /^[6-9]\d{9}$/.test(p.replace(/\D/g,'')),
  pincode:  (p: string) => /^\d{6}$/.test(p.trim()),
  name:     (n: string) => n.trim().length >= 2,
  address:  (a: string) => a.trim().length >= 5,
  password: (p: string) => p.length >= 6,
}

export type FormErrors = Record<string, string>

export function validateProfileName(fname: string): FormErrors {
  const e: FormErrors = {}
  if (!fname.trim()) e.fname = 'First name is required'
  else if (!validate.name(fname)) e.fname = 'Name must be at least 2 characters'
  return e
}

export function validateAddress(fields: {
  addr: string; city: string; state: string; pin: string
}): FormErrors {
  const e: FormErrors = {}
  if (!fields.addr.trim())        e.addr  = 'Street address is required'
  else if (!validate.address(fields.addr)) e.addr = 'Address too short'
  if (!fields.city.trim())        e.city  = 'City is required'
  if (!fields.state)              e.state = 'Please select a state'
  if (!fields.pin.trim())         e.pin   = 'Pincode is required'
  else if (!validate.pincode(fields.pin)) e.pin = 'Enter a valid 6-digit pincode'
  return e
}

export function validateNewAddress(fields: {
  label: string; flat: string; city: string; state: string; pin: string
}): FormErrors {
  const e: FormErrors = {}
  if (!fields.label)              e.label = 'Please select a label'
  if (!fields.flat.trim())        e.flat  = 'Street address is required'
  if (!fields.city.trim())        e.city  = 'City is required'
  if (!fields.state)              e.state = 'Please select a state'
  if (fields.pin && !validate.pincode(fields.pin)) e.pin = 'Enter a valid 6-digit pincode'
  return e
}

export function validatePhone(phone: string): FormErrors {
  const e: FormErrors = {}
  if (!phone.trim())              e.phone = 'Phone number is required'
  else if (!validate.phone(phone)) e.phone = 'Enter a valid 10-digit mobile number (starts with 6–9)'
  return e
}

export function validatePassword(newp: string, conf: string): FormErrors {
  const e: FormErrors = {}
  if (!newp || !validate.password(newp)) e.newp = 'Password must be at least 6 characters'
  if (newp !== conf)                     e.conf = 'Passwords do not match'
  return e
}
