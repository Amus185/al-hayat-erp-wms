import { trackOrder } from "@/lib/erp";
import { clientIp, isJson, isSameSiteRequest } from "@/lib/request-guard";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Looks up an order for the Track page. The ERP checks that the phone matches
// the order and limits attempts; the server-side API key never reaches the browser.
export async function POST(request: Request) {
  if (!isSameSiteRequest(request) || !isJson(request)) {
    return Response.json({ message: "Not allowed" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const number = text(body?.requestNumber, 40);
  const phone = text(body?.phone, 30);
  if (!number || phone.replace(/\D/g, "").length < 7) {
    return Response.json({ message: "Enter your order number and the phone number you ordered with." }, { status: 400 });
  }
  const result = await trackOrder(number, phone, clientIp(request));
  if (!result.ok) return Response.json({ message: result.message }, { status: result.status });
  return Response.json(result.order, { headers: { "Cache-Control": "no-store" } });
}
