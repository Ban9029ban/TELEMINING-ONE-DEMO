const React = require("react");

function MemoryRouter({ children }) {
  return React.createElement(React.Fragment, null, children);
}

function Navigate({ to }) {
  return React.createElement("div", { "data-testid": "navigate-mock" }, String(to || ""));
}

function Route({ element, children }) {
  return React.createElement(React.Fragment, null, element || children || null);
}

function Routes({ children }) {
  return React.createElement(React.Fragment, null, children);
}

function Link({ children, to, ...props }) {
  return React.createElement("a", { href: to || "#", ...props }, children);
}

function Outlet() {
  return null;
}

function useNavigate() {
  return () => {};
}

function useLocation() {
  return { pathname: "/" };
}

module.exports = {
  Link,
  MemoryRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate
};