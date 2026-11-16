import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { ManageFollow } from "./manage";

export const metadata = { title: "Manage a follow", robots: { index: false, follow: false } };

export default function FollowPage() {
  return (
    <div>
      <p className="label mb-2">Follow</p>
      <h1 className="title mb-4">Manage a follow</h1>
      <p className="text-sm text-muted mb-8 max-w-2xl">Enter the manage token you saved when you started following to see deliveries or stop it.</p>
      <Suspense fallback={<Skeleton h={160} />}>
        <ManageFollow />
      </Suspense>
    </div>
  );
}
