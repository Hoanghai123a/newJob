import * as React from "react";

export type OverlaySectionTypes = {
  header: React.ElementType;
  body: React.ElementType;
  footer: React.ElementType;
};

export function flattenOverlayChildren(children: React.ReactNode): React.ReactNode[] {
  const result: React.ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (
      React.isValidElement<{ children?: React.ReactNode }>(child) &&
      child.type === React.Fragment
    ) {
      result.push(...flattenOverlayChildren(child.props.children));
      return;
    }
    result.push(child);
  });

  return result;
}

export function isOverlayElement(
  child: React.ReactNode,
  type: React.ElementType,
): child is React.ReactElement {
  return React.isValidElement(child) && child.type === type;
}

export function splitOverlayChildren(children: React.ReactNode, types: OverlaySectionTypes) {
  const flattened = flattenOverlayChildren(children);
  const header: React.ReactNode[] = [];
  const body: React.ReactNode[] = [];
  const footer: React.ReactNode[] = [];

  for (const child of flattened) {
    if (isOverlayElement(child, types.header)) {
      header.push(child);
    } else if (isOverlayElement(child, types.footer)) {
      footer.push(child);
    } else {
      body.push(child);
    }
  }

  return {
    header,
    body,
    footer,
    hasExplicitBody: body.some((child) => isOverlayElement(child, types.body)),
  };
}
