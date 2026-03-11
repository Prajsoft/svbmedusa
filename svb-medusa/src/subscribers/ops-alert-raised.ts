import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { resolveCorrelationId, setCorrelationContext } from "../modules/logging/correlation"
import { logStructured } from "../modules/logging/structured-logger"

type OpsAlertType = "stuck_fulfillment" | "cod_capture_pending" | "returns_qc_stuck"
type OpsAlertSeverity = "medium" | "high"

type OpsAlertPayload = {
  type: OpsAlertType
  severity: OpsAlertSeverity
  entity_id: string
  reason: string
  suggested_action: string
}

type OpsAlertRaisedDependencies = {
  getAdminEmail: () => string | null
  sendNotification: (
    container: unknown,
    input: {
      to: string
      template: string
      data: Record<string, unknown>
    }
  ) => Promise<void>
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function defaultGetAdminEmail(): string | null {
  return readText(process.env.ADMIN_ALERT_EMAIL) || null
}

async function defaultSendNotification(
  container: unknown,
  input: { to: string; template: string; data: Record<string, unknown> }
): Promise<void> {
  const notificationModule = (container as any)?.resolve?.(Modules.NOTIFICATION)
  if (!notificationModule) {
    throw new Error("Notification module not available")
  }
  await notificationModule.createNotifications([
    {
      to: input.to,
      channel: "email",
      template: input.template,
      data: input.data,
    },
  ])
}

export function createOpsAlertRaisedHandler(
  dependencies?: Partial<OpsAlertRaisedDependencies>
) {
  const deps: OpsAlertRaisedDependencies = {
    getAdminEmail: defaultGetAdminEmail,
    sendNotification: defaultSendNotification,
    ...dependencies,
  }

  return async function opsAlertRaisedSubscriber({
    event,
    container,
  }: SubscriberArgs<Record<string, unknown>>) {
    const data = (event?.data ?? {}) as Record<string, unknown>
    const correlationId = resolveCorrelationId(
      readText(data.correlation_id) || undefined
    )

    const alert: OpsAlertPayload = {
      type: readText(data.type) as OpsAlertType,
      severity: (readText(data.severity) || "medium") as OpsAlertSeverity,
      entity_id: readText(data.entity_id),
      reason: readText(data.reason),
      suggested_action: readText(data.suggested_action),
    }

    const orderId = readText(data.order_id) || readText((event as any)?.order_id)
    const returnId = readText(data.return_id) || readText((event as any)?.return_id)

    if (!alert.type) {
      return
    }

    setCorrelationContext({
      correlation_id: correlationId,
      workflow_name: "subscriber_ops_alert_raised",
    })

    const adminEmail = deps.getAdminEmail()
    if (!adminEmail) {
      logStructured(container as any, "warn", "ops alert not emailed: ADMIN_ALERT_EMAIL not set", {
        workflow_name: "subscriber_ops_alert_raised",
        step_name: "skip",
        meta: { alert_type: alert.type, entity_id: alert.entity_id },
      })
      return
    }

    try {
      await deps.sendNotification(container, {
        to: adminEmail,
        template: "ops-alert",
        data: {
          ...alert,
          order_id: orderId || undefined,
          return_id: returnId || undefined,
          correlation_id: correlationId,
        },
      })

      logStructured(container as any, "info", "ops alert email sent", {
        workflow_name: "subscriber_ops_alert_raised",
        step_name: "sent",
        meta: {
          alert_type: alert.type,
          severity: alert.severity,
          entity_id: alert.entity_id,
          to: adminEmail,
        },
      })
    } catch (error) {
      // Non-fatal: log and swallow — alert email failure must not crash the job
      logStructured(container as any, "error", "ops alert email failed", {
        workflow_name: "subscriber_ops_alert_raised",
        step_name: "send_error",
        meta: {
          alert_type: alert.type,
          entity_id: alert.entity_id,
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }
}

export default createOpsAlertRaisedHandler()

export const config: SubscriberConfig = {
  event: "ops.alert.raised",
}
