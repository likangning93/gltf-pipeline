'use strict';
var Cesium = require('cesium');
var CesiumMath = Cesium.Math;
var Cartesian2 = Cesium.Cartesian2;
var defined = Cesium.defined;

// based on algorithm 2 at http://http.developer.nvidia.com/GPUGems2/gpugems2_chapter42.html
// for each cell that the triangle overlaps, do function(parameter)
// rasterization happens in unit space and assumes square pixels
// inputs: resolution, triangle UV coordinates as Cartesian2s, function, parameters
// pixel function will be run as pixelFunction(u, v, parameters)
// should also indicate whether or not pixel march should prematurely return.
var bigTriangle0 = new Cartesian2();
var bigTriangle1 = new Cartesian2();
var bigTriangle2 = new Cartesian2();
var displacedEdge1Origin = new Cartesian2();
var displacedEdge1End = new Cartesian2();
var displacedEdge2Origin = new Cartesian2();
var displacedEdge2End = new Cartesian2();
var displacedEdge3Origin = new Cartesian2();
var displacedEdge3End = new Cartesian2();
var triangleCenter = new Cartesian2();

function rasterizeTriangleConservative(resolution, triangle, pixelFunction, parameters) {
    var pixelWidth = 1.0 / resolution;
    var halfWidth = pixelWidth * 0.5;

    var p0 = triangle[0];
    var p1 = triangle[1];
    var p2 = triangle[2];

    ////// Compute the "big" triangle //////
    // To determine "out from the triangle," keep track of the center of the triangle and point away from it.
    triangleCenter.x = 0.0;
    triangleCenter.y = 0.0;
    triangleCenter = Cartesian2.add(p0, triangleCenter, triangleCenter);
    triangleCenter = Cartesian2.add(p1, triangleCenter, triangleCenter);
    triangleCenter = Cartesian2.add(p2, triangleCenter, triangleCenter);
    triangleCenter = Cartesian2.divideByScalar(triangleCenter, 3.0, triangleCenter);

    displaceLine(triangleCenter, p0, p1, halfPixelWidth, displacedEdge1Origin, displacedEdge1End);
    displaceLine(triangleCenter, p1, p2, halfPixelWidth, displacedEdge2Origin, displacedEdge2End);
    displaceLine(triangleCenter, p2, p0, halfPixelWidth, displacedEdge3Origin, displacedEdge3End);

    lineLineIntersect(displacedEdge1Origin, displacedEdge1End, displacedEdge2Origin, displacedEdge2End, bigTriangle0);
    lineLineIntersect(displacedEdge2Origin, displacedEdge2End, displacedEdge3Origin, displacedEdge3End, bigTriangle1);
    lineLineIntersect(displacedEdge3Origin, displacedEdge3End, displacedEdge1Origin, displacedEdge1End, bigTriangle2);

    ////// Compute a pixel width padded AABB for the standard size triangle //////

    ////// Pixel march over the pixel padded AABB for the triangle: //////
        // For each pixel center, check if it is in the "big" triangle using barycentric coordinates
        // If so, perform the pixel function
        // Return pixelFunction value if pixelFunction indicates to return
}

function displaceLine(triangleCenter, origin, end, halfPixelWidth, scratch_resultPoint1, scratch_resultPoint2) {
    ////// Compute displacement direction //////
    // Compute direction "out" of triangle perpendicular to line
    var normal = scratch_resultPoint1;
    normal = Cartesian2.subtract(end, origin, normal);
    Cartesian2.normalize(normal, normal);
    // Get general direction "into" triangle so we can check that the direction "out" is "out"
    var intoTriangle = scratch_resultPoint2;
    intoTriangle = Cartesian2.subtract(triangleCenter, origin, intoTriangle);
    Cartesian2.normalize(intoTriangle, intoTriangle);
    if (Cartesian2.dot(normal, intoTriangle) < 0.0) {
        var swap = normal.x;
        normal.x = -normal.y;
        normal.y = -swap;
    }
    // get the correct semiDiagonal displacement
    var displace = scratch_resultPoint2;
    displace.x = (normal.x > 0.0) ? halfPixelWidth : -halfPixelWidth;
    displace.y = (normal.y > 0.0) ? halfPixelWidth : -halfPixelWidth;
    scratch_resultPoint1 = Cartesian2.add(origin, displace);
    scratch_resultPoint2 = Cartesian2.add(end, displace);
}

function lineLineIntersect(p1, p2, p3, p4, result) {
    // http://paulbourke.net/geometry/pointlineplane/
    var denominator = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    var uA = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denominator;
    var uB = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denominator;
    result.x = p1.x + uA * (p2.x - p1.x);
    result.y = p1.y + uB * (p2.y - p1.y);
    return result;
}