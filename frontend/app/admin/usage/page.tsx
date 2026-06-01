import { redirect } from "next/navigation";

export default function AdminLegacyRedirect() {
  redirect("/management/usage");
}
