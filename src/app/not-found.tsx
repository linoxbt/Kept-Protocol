import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-k py-32 text-center">
      <p className="mono text-accent mb-2">404</p>
      <h1 className="title mb-4">No record here</h1>
      <p className="text-muted mb-6">Kept has nothing at this address. That is not evidence of anything.</p>
      <Link className="btn" href="/">back to Kept</Link>
    </div>
  );
}
