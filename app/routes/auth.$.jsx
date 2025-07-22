import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const authResult = await authenticate.admin(request);
  if (authResult instanceof Response) return authResult;

  const { session } = authResult;
  if (!session?.shop) {
    return json({ error: "No shop in session" }, { status: 400 });
  }

  return null;
};
