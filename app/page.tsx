import { redirect } from "next/navigation";

export default function Home() {
  // Redirect to login page
  // TODO: Check authentication status and redirect to /inbox if logged in
  redirect("/login");
}
