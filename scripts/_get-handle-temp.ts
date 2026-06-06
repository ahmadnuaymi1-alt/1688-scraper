import { config } from "dotenv";
config({ path: ".env.local" });
import { prisma } from "../src/lib/db";

(async () => {
  const p = await prisma.product.findUnique({
    where: { id: "cmpjswsmv00rfw2ggb4z2n7tb" },
    select: { title: true, uploads: { select: { shopifyHandle: true, status: true, shopifyProductId: true } } },
  });
  console.log(JSON.stringify(p, null, 2));
  await prisma.$disconnect();
})();
