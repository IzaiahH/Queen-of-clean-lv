import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

export default function Forbidden() {
  return <EmptyState title="You don't have access to that page" action={<Link className="btn btn-dark" href="/admin">Back to dashboard</Link>}>Ask the owner if you need access.</EmptyState>;
}
