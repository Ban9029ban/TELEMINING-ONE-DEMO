import React from "react";
import { render } from "@testing-library/react";
import "./setupRouteTestMocks";
jest.mock("react-router-dom", () => require("./mockReactRouterDom"), { virtual: true });
import { MemoryRouter } from "react-router-dom";
import GeneralRoutes from "../routes/General";

describe("GeneralRoutes", () => {
  test("renderiza sin explotar en una ruta base", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <GeneralRoutes />
      </MemoryRouter>
    );
  });
});