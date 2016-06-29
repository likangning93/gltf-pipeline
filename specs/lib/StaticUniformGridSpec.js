'use strict';
var Cesium = require('cesium');
var CesiumMath = Cesium.Math;
var AxisAlignedBoundingBox = Cesium.AxisAlignedBoundingBox;
var Cartesian3 = Cesium.Cartesian3;
var StaticUniformGrid = require('../../lib/StaticUniformGrid');

describe('StaticUniformGrid', function() {
    var pointData = [];

    for (var x = 1; x < 8; x++) {
        for (var y = 1; y < 8; y++) {
            for (var z = 1; z < 8; z++) {
                pointData.push([x, y, z]);
            }
        }
    }

    function pointDataAABBFunction(point, min, max) {
        min.x = Math.min(min.x, point[0]);
        min.y = Math.min(min.y, point[1]);
        min.z = Math.min(min.z, point[2]);
        max.x = Math.max(max.x, point[0]);
        max.y = Math.max(max.y, point[1]);
        max.z = Math.max(max.z, point[2]);
    }

    function pointDataCellCheckFunction(point, position, stepWidth) {
        return (
            point[0] >= position.x &&
            point[1] >= position.y &&
            point[2] >= position.z &&
            point[0] <= position.x + stepWidth &&
            point[1] <= position.y + stepWidth &&
            point[2] <= position.z + stepWidth
        );
    }

    var cartesian3Scratch = new Cartesian3();

    fit('populates a uniform grid with cells based on the center of the data AABB and the resolution', function() {
        var grid = new StaticUniformGrid(pointData, 3.0, pointDataAABBFunction, pointDataCellCheckFunction);
        var expectedCenter = cartesian3Scratch;
        expectedCenter.x = 4.0;
        expectedCenter.y = 4.0;
        expectedCenter.z = 4.0;
        expect(Cartesian3.equalsEpsilon(expectedCenter, grid.AABB.center, CesiumMath.EPSILON7)).toEqual(true);

        var expectedMin = cartesian3Scratch;
        expectedMin.x = -0.5;
        expectedMin.y = -0.5;
        expectedMin.z = -0.5;
        expect(Cartesian3.equalsEpsilon(expectedMin, grid.AABB.minimum, CesiumMath.EPSILON7)).toEqual(true);

        var expectedMax = cartesian3Scratch;
        expectedMax.x = 8.5;
        expectedMax.y = 8.5;
        expectedMax.z = 8.5;
        expect(Cartesian3.equalsEpsilon(expectedMax, grid.AABB.maximum, CesiumMath.EPSILON7)).toEqual(true);
    });
});