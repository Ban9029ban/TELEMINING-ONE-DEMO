import React from "react";
import { render } from "@testing-library/react";

import "./tests/setupRouteTestMocks";

jest.mock("react-router-dom", () => require("./tests/mockReactRouterDom"), { virtual: true });

import App from "./App";

test("renderiza la aplicación sin explotar", () => {
  render(<App />);
});