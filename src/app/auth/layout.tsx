// Bare layout for /auth/* — no Header/Footer/CartDrawer
// Prevents store maintenance check from blocking OAuth callback
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
