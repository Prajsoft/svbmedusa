"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.default = orderPlacedHandler;
const send_order_confirmation_1 = require("../workflows/send-order-confirmation");
async function orderPlacedHandler({ event: { data }, container, }) {
    const logger = container.resolve("logger");
    logger.info(`order.placed event received — Order ID: ${data.id}`);
    try {
        await (0, send_order_confirmation_1.sendOrderConfirmationWorkflow)(container).run({
            input: { id: data.id },
        });
        logger.info(`Order confirmation email sent for Order ID: ${data.id}`);
    }
    catch (error) {
        logger.error(`Failed to send order confirmation for Order ID: ${data.id}`, error);
    }
}
exports.config = {
    event: "order.placed",
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JkZXItcGxhY2VkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3N1YnNjcmliZXJzL29yZGVyLXBsYWNlZC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFHQSxxQ0FvQkM7QUF0QkQsa0ZBQW9GO0FBRXJFLEtBQUssVUFBVSxrQkFBa0IsQ0FBQyxFQUMvQyxLQUFLLEVBQUUsRUFBRSxJQUFJLEVBQUUsRUFDZixTQUFTLEdBQ3NCO0lBQy9CLE1BQU0sTUFBTSxHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUE7SUFFMUMsTUFBTSxDQUFDLElBQUksQ0FBQywyQ0FBMkMsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUE7SUFFakUsSUFBSSxDQUFDO1FBQ0gsTUFBTSxJQUFBLHVEQUE2QixFQUFDLFNBQVMsQ0FBQyxDQUFDLEdBQUcsQ0FBQztZQUNqRCxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtTQUN2QixDQUFDLENBQUE7UUFFRixNQUFNLENBQUMsSUFBSSxDQUFDLCtDQUErQyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUN2RSxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE1BQU0sQ0FBQyxLQUFLLENBQ1YsbURBQW1ELElBQUksQ0FBQyxFQUFFLEVBQUUsRUFDNUQsS0FBYyxDQUNmLENBQUE7SUFDSCxDQUFDO0FBQ0gsQ0FBQztBQUVZLFFBQUEsTUFBTSxHQUFxQjtJQUN0QyxLQUFLLEVBQUUsY0FBYztDQUN0QixDQUFBIn0=