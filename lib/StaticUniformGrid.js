'use strict';
var Cesium = require('cesium');
var Cartesian3 = Cesium.Cartesian3;
var DeveloperError = Cesium.DeveloperError;
var triBoxOverlap = require('../../lib/triBoxOverlap');
var clone = require('clone');

/**
 * A Uniform Grid for unmoving objects.
 * @alias StaticUniformGrid
 * @constructor
 *
 * @param {Object[]} objects Objects that the grid should store.
 * @param {Function} aabbFunction A function for checking the axis aligned bounding box of an object in space.
 *                   This function should expect to take an object and a `min` and `max` Cartesian3. It should update
 *                   `min` and `max` in place.
 * @param {Function} cellCheckFunction A function for checking if an object intersects a grid cell, given as 2 Cartesian3s.
 *                   This function should expect to take an object and the bounding cell's `min` and cell width. It should
 *                   return `true` if the object intersects with the cell at all and `false` otherwise.
 * @param {Number} cellWidth, The cell width of the uniform grid.
 */

var centerScratch = new Cartesian3();
var minScratch = new Cartesian3();
var maxScratch = new Cartesian3();

function StaticUniformGrid(cellWidth) {
    if (!defined(cellWidth)) {
        throw new DeveloperError('cellWidth is required');
    }

    /**
     * The width of a single cell.
     * @type {Number}
     */
    this.cellWidth = cellWidth;

    /**
     * The minimum coordinate of the uniform grid.
     * @type {Cartesian3}
     */
    this.min = new Cartesian3(Math.POSITIVE_INFINITY, Math.POSITIVE_INFINITY, Math.POSITIVE_INFINITY);

    /**
     * The maximum coordinate of the uniform grid.
     * @type {Cartesian3}
     */
    this.max = new Cartesian3(Math.NEGATIVE_INFINITY, Math.NEGATIVE_INFINITY, Math.NEGATIVE_INFINITY);

    /**
     * The cell count in each dimension.
     * @type {Cartesian3}
     */
    this.resolution = new Cartesian3();

    /**
     * Start index for each cell's data within the data array.
     * @type {Number[]}
     */
    this.cellIndices = [];


    /**
     * Count for each cell's data within the data array.
     * @type {Number[]}
     */
    this.cellCounts = [];

    /**
     * Array of objects
     * @type {Array}
     */
    this.data = [];
}

var cellMarchScratch = new Cartesian3();
StaticUniformGrid.boundingBoxMarch = function(grid, min, max, marchFunction, parameters) {
    var stepWidth = grid.cellWidth;
    var gridMin = grid.min;
    var resolution = grid.resolution;

    // Compute the minimum coordinate of the first cell
    cellMarchScratch.x = Math.floor((min.x - gridMin.x) / stepWidth) * stepWidth + gridMin.x;
    cellMarchScratch.y = Math.floor((min.y - gridMin.y) / stepWidth) * stepWidth + gridMin.y;
    cellMarchScratch.z = Math.floor((min.z - gridMin.z) / stepWidth) * stepWidth + gridMin.z;

    var xStart = cellMarchScratch.x;
    var yStart = cellMarchScratch.y;

    // Compute the number of cells that min and max cover in each dimension.
    var xCount = Math.floor((max.x - min.x) / stepWidth) + 1;
    var yCount = Math.floor((max.y - min.y) / stepWidth) + 1;
    var zCount = Math.floor((max.z - min.z) / stepWidth) + 1;
    var index = 0;

    // March over the cells that the grid covers.
    for (var z = 0; z < zCount; z++) {
        for (var y = 0; y < yCount; y++) {
            for (var x = 0; x < xCount; x++) {
                marchFunction(parameters, cellMarchScratch, stepWidth);
                cellMarchScratch.x += stepWidth;
            }
            cellMarchScratch.x = xStart;
            cellMarchScratch.y += stepWidth;
        }
        cellMarchScratch.y = yStart;
        cellMarchScratch.z += stepWidth;
    }
};

StaticUniformGrid.indexOfPosition = function(grid, position) {
    var min = grid.min;
    var cellWidth = grid.cellWidth;
    var resolution = grid.resolution;
    var x = Math.floor((position.x - min.x) / cellWidth);
    var y = Math.floor((position.y - min.y) / cellWidth);
    var z = Math.floor((position.z - min.z) / cellWidth);
    return x + y * resolution.x + z * resolution.x * resolution.y;
};

StaticUniformGrid.populate = function(grid, data, aabbFunction, cellCheckFunction) {
    var max = grid.max;
    var min = grid.min;
    min.x = Math.POSITIVE_INFINITY;
    min.y = Math.POSITIVE_INFINITY;
    min.z = Math.POSITIVE_INFINITY;
    max.x = Math.NEGATIVE_INFINITY;
    max.y = Math.NEGATIVE_INFINITY;
    max.z = Math.NEGATIVE_INFINITY;

    var resolution = grid.resolution;
    var cellCount = resolution.x * resolution.y * resolution.z;

    ////// Find the min/max bounds and resolution of the uniform grid. //////
    var objectCount = data.length;
    for (var i = 0; i < objectCount; i++) {
        aabbFunction(data[i], min, max);
    }

    // Figure out what the grid's resolution should be. Pad min and max out to match. //////
    resolution.x = Math.floor((max.x - min.x) / cellWidth) + 1;
    resolution.y = Math.floor((max.y - min.y) / cellWidth) + 1;
    resolution.z = Math.floor((max.z - min.z) / cellWidth) + 1;

    var center = Cartesian3.add(min, max, centerScratch);
    center = Cartesian3.divideByScalar(centerScratch, 2.0, centerScratch);
    min.x = center.x - (resolution.x / 2.0) * cellWidth;
    min.y = center.y - (resolution.y / 2.0) * cellWidth;
    min.z = center.z - (resolution.z / 2.0) * cellWidth;
    max.x = center.x + (resolution.x / 2.0) * cellWidth;
    max.y = center.y + (resolution.y / 2.0) * cellWidth;
    max.z = center.z + (resolution.z / 2.0) * cellWidth;

    ////// Bin the objects. //////
    var allCellData = [];
    for (i = 0; i < cellCount; i++) {
        allCellData.push({
            itemCount : 0,
            items : []
        });
    }

    var parameters = {
        allCellData : allCellData,
        cellCheckFunction : cellCheckFunction,
        grid : grid,
        item : undefined
    };

    //For each object:
    for (i = 0; i < objectCount; i++) {
        var item = data[i];

        // Get the object's AABB
        minScratch.x = Math.POSITIVE_INFINITY;
        minScratch.y = Math.POSITIVE_INFINITY;
        minScratch.z = Math.POSITIVE_INFINITY;
        maxScratch.x = Math.NEGATIVE_INFINITY;
        maxScratch.y = Math.NEGATIVE_INFINITY;
        maxScratch.z = Math.NEGATIVE_INFINITY;
        aabbFunction(item, minScratch, maxScratch);

        // Step over the cells in the AABB, checking for each cell if the object intersects this cell
        parameters.item = item;
        StaticUniformGrid.boundingBoxMarch(grid, minScratch, maxScratch, binObject, parameters);
    }

    // Store all the object copies in one contiguous array for better spatial locality
    var cellItems = grid.data;
    var cellIndices = grid.cellIndices;
    var cellCounts = grid.cellCounts;

    var firstFreeIndex = 0;
    for (i = 0; i < cellCount; i++) {
        var cellData = allCellData[i];
        var itemCount = cellData.itemCount;
        var items = cellData.items;
        cellIndices.push(firstFreeIndex);
        cellCounts.push(itemCount);
        for (var j = 0; j < itemCount; j++) {
            cellItems.push(clone(items[j]))
        }
    }
};

var binObjectScratch = new Cartesian3();
function binObject(parameters, position, stepWidth) {
    var item = parameters.item;
    var cellCheckFunction = parameters.cellCheckFunction;

    // Check if this item overlaps the cell. If not, return.
    if (!cellCheckFunction(item, position, stepWidth)) {
        return;
    }

    // Bin
    binObjectScratch.x = position.x + stepWidth / 2.0;
    binObjectScratch.y = position.y + stepWidth / 2.0;
    binObjectScratch.z = position.z + stepWidth / 2.0;

    var index = StaticUniformGrid.indexOfPosition(parameters.grid, binObjectScratch);
    var cellData = parameters.allCellData[index];
    cellData.itemCount++;
    cellData.items.push(item);
}

StaticUniformGrid.forEachNeighbor = function(grid, position, neighborFunction, parameters) {

};

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

var triangleCheckScratch = new Cartesian3();
var halfDimensionsScratch = new Cartesian3();
function triangleCellCheck(triangle, cellMin, cellWidth) {
    var halfWidth = cellWidth / 2.0;
    halfDimensionsScratch.x = halfWidth;
    halfDimensionsScratch.y = halfWidth;
    halfDimensionsScratch.z = halfWidth;

    triangleCheckScratch.x = cellMin.x + halfWidth;
    triangleCheckScratch.y = cellMin.y + halfWidth;
    triangleCheckScratch.z = cellMin.z + halfWidth;

    return triBoxOverlap(triangleCheckScratch, halfDimensionsScratch, triangle);
}
