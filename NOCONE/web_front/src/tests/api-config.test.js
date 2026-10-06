describe("api-config", () => {
  const OLD_ENV = process.env;
  const OLD_RUNTIME_ENV = window.__ENV;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.REACT_APP_API_URL;
    delete window.__ENV;
  });

  afterAll(() => {
    process.env = OLD_ENV;
    window.__ENV = OLD_RUNTIME_ENV;
  });

  test("usa REACT_APP_API_URL cuando existe", async () => {
    process.env.REACT_APP_API_URL = "http://test_backend_app:8000/api";
    const mod = await import("../api-config");
    expect(mod.API_URL).toBe("http://test_backend_app:8000/api");
  });

  test("normaliza REACT_APP_API_URL cuando viene sin /api", async () => {
    process.env.REACT_APP_API_URL = "http://test_backend_app:8000";
    const mod = await import("../api-config");
    expect(mod.API_URL).toBe("http://test_backend_app:8000/api");
  });

  test("normaliza window.__ENV.API_URL cuando viene sin /api", async () => {
    window.__ENV = { API_URL: "http://runtime-backend:8000" };
    const mod = await import("../api-config");
    expect(mod.API_URL).toBe("http://runtime-backend:8000/api");
  });

  test("si no existe REACT_APP_API_URL expone un string no vacio", async () => {
    const mod = await import("../api-config");
    expect(typeof mod.API_URL).toBe("string");
    expect(mod.API_URL.length).toBeGreaterThan(0);
  });
});