import { json, route } from "@/lib/http";
import { feed } from "@/services/queries";

export const GET = route(async () => json({ data: await feed(50) }, { sign: true, cache: "public, max-age=15" }));
