// Bare layout for /auth/* routes — no Header, Footer, or CartDrawer
// This prevents the store maintenance check and layout flash during OAuth redirect
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
