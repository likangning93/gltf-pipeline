'use strict';
var Cesium = require('cesium');
var AxisAlignedBoundingBox = Cesium.AxisAlignedBoundingBox;
var Cartesian3 = Cesium.Cartesian3;
var StaticUniformGrid = require('./StaticUniformGrid');
var triangleAxisAlignedBoundingBoxOverlap = require('./triangleAxisAlignedBoundingBoxOverlap');

module.exports = buildTriangleStaticUniformGrid;

function buildTriangleStaticUniformGrid(data, cellWidth) {
    return new StaticUniformGrid(data, cellWidth, triangleAABB, triangleCellCheck);
}

function triangleAABB(triangle, min, max) {
    min.x = Math.min(triangle[0].x, min.x);
    min.y = Math.min(triangle[0].y, min.y);
    min.z = Math.min(triangle[0].z, min.z);
    max.x = Math.max(triangle[0].x, max.x);
    max.y = Math.max(triangle[0].y, max.y);
    max.z = Math.max(triangle[0].z, max.z);

    min.x = Math.min(triangle[1].x, min.x);
    min.y = Math.min(triangle[1].y, min.y);
    min.z = Math.min(triangle[1].z, min.z);
    max.x = Math.max(triangle[1].x, max.x);
    max.y = Math.max(triangle[1].y, max.y);
    max.z = Math.max(triangle[1].z, max.z);

    min.x = Math.min(triangle[2].x, min.x);
    min.y = Math.min(triangle[2].y, min.y);
    min.z = Math.min(triangle[2].z, min.z);
    max.x = Math.max(triangle[2].x, max.x);
    max.y = Math.max(triangle[2].y, max.y);
    max.z = Math.max(triangle[2].z, max.z);
}

var halfDimensionsScratch = new Cartesian3();
var aabbScratch = new AxisAlignedBoundingBox();
function triangleCellCheck(triangle, cellMin, cellWidth) {
    var halfWidth = cellWidth * 0.5;
    var center = aabbScratch.center;
    var maximum = aabbScratch.maximum;

    halfDimensionsScratch.x = halfWidth;
    halfDimensionsScratch.y = halfWidth;
    halfDimensionsScratch.z = halfWidth;

    aabbScratch.minimum = cellMin;
    center = Cartesian3.add(cellMin, halfDimensionsScratch, center);
    maximum = Cartesian3.add(center, halfDimensionsScratch, maximum);

    return triangleAxisAlignedBoundingBoxOverlap(aabbScratch, triangle);
}
