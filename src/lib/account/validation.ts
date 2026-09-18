// ─────────────────────────────────────────────────────────────
// Validation helpers — reusable across all account forms
// ─────────────────────────────────────────────────────────────

export const validate = {
  phone:    (p: string) => /^[6-9]\d{9}$/.test(p.replace(/\D/g,'')),
  pincode:  (p: string) => /^\d{6}$/.test(p.trim()),
  name:     (n: string) => n.trim().length >= 2,
  address:  (a: string) => a.trim().length >= 5,
  // Each rule is exported so PasswordSection can drive the strength indicator
  // from the same logic — no duplication, no drift.
  password: {
    minLength:   (p: string) => p.length >= 8,
    hasUpper:    (p: string) => /[A-Z]/.test(p),
    hasNumber:   (p: string) => /\d/.test(p),
    hasSpecial:  (p: string) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(p),
    /** Returns true only when ALL rules pass. */
    isValid:     (p: string) =>
      validate.password.minLength(p)  &&
      validate.password.hasUpper(p)   &&
      validate.password.hasNumber(p)  &&
      validate.password.hasSpecial(p),
    /** 0–4 score used by the strength bar. */
    score:       (p: string) => [
      validate.password.minLength(p),
      validate.password.hasUpper(p),
      validate.password.hasNumber(p),
      validate.password.hasSpecial(p),
    ].filter(Boolean).length,
  },
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
  label: string; flat: string; city: string; state: string; pin: string; phone: string
}): FormErrors {
  const e: FormErrors = {}
  if (!fields.label)              e.label = 'Please select a label'
  if (!fields.flat.trim())        e.flat  = 'Street address is required'
  if (!fields.city.trim())        e.city  = 'City is required'
  if (!fields.state)              e.state = 'Please select a state'
  if (fields.pin && !validate.pincode(fields.pin)) e.pin = 'Enter a valid 6-digit pincode'
  // Required — this is the number the courier actually calls for THIS address,
  // which may differ from the account holder's own phone (Office/Parents/etc).
  if (!fields.phone.trim())       e.phone = 'Phone number is required'
  else if (!validate.phone(fields.phone)) e.phone = 'Enter a valid 10-digit mobile number (starts with 6–9)'
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
  if (!newp) {
    e.newp = 'New password is required'
  } else if (!validate.password.minLength(newp)) {
    e.newp = 'Password must be at least 8 characters'
  } else if (!validate.password.hasUpper(newp)) {
    e.newp = 'Password must contain at least one uppercase letter'
  } else if (!validate.password.hasNumber(newp)) {
    e.newp = 'Password must contain at least one number'
  } else if (!validate.password.hasSpecial(newp)) {
    e.newp = 'Password must contain at least one special character (!@#$… etc.)'
  }
  if (newp && !e.newp && newp !== conf) e.conf = 'Passwords do not match'
  return e
}
