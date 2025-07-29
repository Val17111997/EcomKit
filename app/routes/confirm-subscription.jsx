import { redirect } from "@remix-run/node";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");
  const shopParam = url.searchParams.get("shop");
  if (chargeId && shopParam) {
    const prisma = (await import("../db.server")).default;
    await prisma.usageSubscription.updateMany({
      where: { shop: shopParam },
      data: { status: "ACTIVE" },
    });
    const adminUrl = `https://${shopParam}/admin/apps/${process.env.SHOPIFY_API_KEY}`;
    return redirect(adminUrl);
  }
  return redirect("/app");
};