import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="mono text-accent mb-2">404</p>
      <h1 className="text-2xl font-semibold mb-4">No record here</h1>
      <p className="text-muted mb-6">Kept has nothing at this address. That is not evidence of anything.</p>
      <Link className="btn" href="/">back to Kept</Link>
    </div>
  );
}
