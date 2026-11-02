// Client-side memory of the saved-address list version the server last gave us (see lib/server/addressEtag.ts).
let etag: string | null = null
export const setAddressEtag = (v: unknown): void => { if (typeof v === 'string' && v) etag = v }
export const getAddressEtag = (): string | null => etag
export const forgetAddressEtag = (): void => { etag = null }
