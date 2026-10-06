import "./setupRouteTestMocks";
jest.mock("react-router-dom", () => require("./mockReactRouterDom"), { virtual: true });
import GeneralRoutes from "../routes/General";

describe("routes completeness", () => {
  test("el módulo de rutas existe", () => {
    expect(GeneralRoutes).toBeTruthy();
  });
});