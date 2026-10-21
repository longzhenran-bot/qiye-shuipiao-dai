export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        service: "qiye-shuipiao-dai"
      });
    }

    return Response.json(
      { error: "Not found" },
      { status: 404 }
    );
  }
};
