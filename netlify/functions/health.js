export async function handler() {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ status: "ok", service: "MIR AI", time: new Date().toISOString() })
  }
}
