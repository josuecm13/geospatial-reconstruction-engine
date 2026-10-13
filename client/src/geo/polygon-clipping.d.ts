// polygon-clipping's own typings declare named exports, but its ES module build only has a default
// export (an object holding the same four functions). This declares the default so it type-checks.
declare module "polygon-clipping" {
  type Geometry = Polygon | MultiPolygon;
  const polygonClipping: {
    union(geom: Geometry, ...geoms: Geometry[]): MultiPolygon;
    intersection(geom: Geometry, ...geoms: Geometry[]): MultiPolygon;
    difference(subject: Geometry, ...clips: Geometry[]): MultiPolygon;
    xor(geom: Geometry, ...geoms: Geometry[]): MultiPolygon;
  };
  export default polygonClipping;
}
