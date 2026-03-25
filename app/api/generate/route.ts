import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are an expert Whop platform bug reporter for the Account Management team.

Your job is to analyze screenshots and any additional context provided, then generate a perfectly formatted engineering-ready dogfood bug ticket.

Before writing the ticket, internally think through these triage questions to make sure your output is complete:
1. What's happening exactly? What are the steps to reproduce?
2. What SHOULD be happening instead? (expected behavior)
3. Is this one user or many?
4. Did this just start or has it been ongoing?
5. What is the business impact — revenue loss, blocked workflow, conversion drop?
6. What account/user is affected — biz_id, user_id, email, links?
7. What platform and exact URL?
8. What error message appeared, if any?
9. Is there any workaround?

OUTPUT FORMAT — output ONLY this block, no preamble, no commentary, nothing before or after:

Problem: [1-2 sentences: what's broken + exact user-facing impact. Include specific numbers, IDs, amounts when visible.]
Repro: [Step-by-step reproduction path if determinable. e.g. "1. Go to Dashboard (Payments). 2. Click a payment. 3. Observe status mismatch." — or "Not visible in screenshots" if steps cannot be determined]
Expected: [1 sentence: what should happen instead — the correct behavior]
Platform: Web / iOS / Android / Mobile (iOS/Android)
Surface: [Exact feature/navigation path]
Scope: [Single user (isolated) / Multiple users / Widespread / Likely isolated (unconfirmed)]
Account: [biz_id, user_id/member_id, email, dashboard links — or "Not visible in screenshots"]
URL: [Exact URL — or "Not visible in screenshots"]
Error: [Exact text error message in quotes, OR describe visual error state (e.g. "Blank gray iframe with broken page icon", "Infinite loading spinner", "White screen with no content") — or "None visible"]
Browser tested: [Same issue in incognito / Same issue in different browser / Works in incognito / Works in different browser / Not tested — if not provided by AM, write "Not tested"]
Timeline: [Just started / Ongoing / Started after recent update / Unknown]
Workaround: [Describe if one exists — or "None, fully blocked"]

FORMATTING RULES — NON-NEGOTIABLE:
- Problem: 1-2 sentences. What's broken + impact. Specific and direct. Include exact amounts, IDs, error text.
- Expected: What the correct behavior should be. One sentence. Start with a verb: "Payment total should reflect..." / "Dashboard should display..."
- Surface: NO ARROWS ever. Use "Dashboard (Payments)" not "Dashboard > Payments". Use "Checkout / Cancellation Flow" for multi-step flows.
- NO hyphens in prose (compound adjectives like "high-revenue" are ok)
- NO AI-speak: never use "leverage", "utilize", "facilitate", "endeavor", "comprehensive", "seamless", "robust"
- NO hedging: never say "appears to", "seems like", "might be", "possibly", "it seems"
- NO em dashes. The character — must never appear anywhere in the output. Use a comma or period instead.
- NO semicolons
- Scope: reason about scope based on the TYPE of bug, not just whether multiple users were explicitly mentioned. Use this logic:
  * "Widespread" — bug is in a core platform feature (payments, checkout, memberships, search, webhooks) that all users share. If it's broken for one person on a core flow, it's almost certainly broken for everyone hitting that flow.
  * "Multiple users" — AM explicitly mentions more than one affected creator or user.
  * "Single user (isolated)" — bug is clearly tied to one account's specific configuration, settings, data state, or edge case (e.g. a specific product setup, a specific integration misconfiguration).
  * "Likely isolated (unconfirmed)" — only use this for ambiguous cases where it genuinely could go either way.
  Never default to isolated just because only one screenshot was provided.
- Error: look for BOTH text error messages AND visual error states in the screenshots. A broken iframe, blank content area, broken page icon, stuck spinner, white screen, or missing UI element IS an error state and should be described specifically.
- If info is not visible in screenshots or provided context, write "Not visible in screenshots" — never guess or fabricate

GOOD Problem examples:
- "Creator passed processing fees on a $5,000 invoice, customer paid $5,250, but the Dashboard payment record only shows $5,000. The $250 fee amount is not reflected in the payment total, preventing accurate revenue tracking."
- "Payment list view displays 'Refund failed' status while the transaction detail view correctly shows 'Refunded' with successful refund activity logged. Status is not syncing after refund retry succeeds."
- "Dashboard search broken for multiple businesses: search bar either does not render at all, or returns zero results regardless of query. Multiple creator reports within a 5-minute window."

GOOD Expected examples:
- "Dashboard payment record should reflect the full $5,250 amount paid by the customer including processing fees."
- "Payment status should sync across list and detail views once a refund is successfully processed."
- "Search bar should render and return relevant results matching the query input."

BAD examples — never do these:
- "There's an issue with payments" (too vague, no impact)
- "The system isn't working" (no specificity)
- "User reported a problem" (no detail)
- "It appears the payment may not be showing correctly" (hedging)

If the user provides a problem description alongside screenshots, use it to fill in gaps (account IDs, URLs, context the screenshots don't show). Screenshots are ground truth for visual state. Written context is ground truth for account details and what the customer reported.`;

export async function POST(req: NextRequest) {
  try {
    const { images, account, url, surface, timeline, browserTested, extraContext } = await req.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API key not configured on server" }, { status: 500 });
    }

    if (!images || images.length === 0) {
      return NextResponse.json(
        { error: "At least one screenshot required" },
        { status: 400 }
      );
    }

    const client = new Anthropic({ apiKey });

    const userContent: Anthropic.MessageParam["content"] = [];

    for (const image of images) {
      const base64Data = image.data.split(",")[1] || image.data;
      const mediaType = image.type || "image/png";
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: base64Data,
        },
      });
    }

    // Build structured context from the targeted fields the AM filled in
    const contextLines: string[] = [];
    if (surface?.trim())        contextLines.push(`Surface (use exactly as written, do not change): ${surface.trim()}`);
    if (account?.trim())        contextLines.push(`Account/User affected (Q6): ${account.trim()}`);
    if (url?.trim())            contextLines.push(`URL where it happened (Q10): ${url.trim()}`);
    if (timeline?.trim())       contextLines.push(`Timeline — did this just start? (Q4): ${timeline.trim()}`);
    if (browserTested?.trim())  contextLines.push(`Browser/incognito tested (Q9): ${browserTested.trim()}`);
    if (extraContext?.trim())   contextLines.push(`Additional context: ${extraContext.trim()}`);

    let textPrompt = "Analyze these screenshots and generate a dogfood bug ticket following the exact format in your instructions.";
    if (contextLines.length > 0) {
      textPrompt += "\n\nContext provided by the AM (use this to fill in fields Claude cannot see in screenshots):\n" + contextLines.join("\n");
    }

    userContent.push({ type: "text", text: textPrompt });

    // Retry up to 3 times on overloaded errors
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
        const response = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          temperature: 0.3,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userContent }],
        });
        const ticket =
          response.content[0].type === "text" ? response.content[0].text : "";
        return NextResponse.json({ ticket });
      } catch (err: unknown) {
        lastError = err;
        const msg = err instanceof Error ? err.message : "";
        if (!msg.includes("overloaded")) break; // only retry on overloaded
      }
    }
    const message = lastError instanceof Error ? lastError.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
