export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        service: "qiye-shuipiao-dai"
      });
    }

    if (url.pathname === "/api/db-health") {
      if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
        return Response.json(
          { status: "unavailable" },
          { status: 503 }
        );
      }

      try {
        const response = await fetch(
          env.SUPABASE_URL +
            "/rest/v1/loan_applications?select=id&limit=0",
          {
            headers: {
              apikey: env.SUPABASE_SECRET_KEY
            }
          }
        );

        return Response.json({
          database: response.ok ? "connected" : "unavailable"
        }, {
          status: response.ok ? 200 : 503
        });
      } catch {
        return Response.json(
          { database: "unavailable" },
          { status: 503 }
        );
      }
    }

    return Response.json(
      { error: "Not found" },
      { status: 404 }
    );
  }
};