import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const template = await prisma.ruleTemplate.findUnique({ where: { id } });
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  // Only allow using user's own templates or global (userId null) ones.
  if (template.userId && template.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // If a rule with the same category already exists for the user, update its
  // config (and name) to match the template. Otherwise create a new rule.
  const existing = await prisma.transformationRule.findFirst({
    where: { userId: user.id, category: template.category },
    orderBy: { createdAt: "asc" },
  });

  let rule;
  if (existing) {
    rule = await prisma.transformationRule.update({
      where: { id: existing.id },
      data: {
        name: template.name,
        config: template.config,
        enabled: true,
      },
    });
  } else {
    rule = await prisma.transformationRule.create({
      data: {
        userId: user.id,
        name: template.name,
        category: template.category,
        config: template.config,
        enabled: true,
      },
    });
  }

  return NextResponse.json({ rule });
}
