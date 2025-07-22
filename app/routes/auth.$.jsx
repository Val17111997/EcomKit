import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const authResult = await authenticate.admin(request);
  if (authResult instanceof Response) return authResult;

  return null;
};
