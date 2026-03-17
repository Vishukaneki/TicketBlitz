"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/seed.ts
var client_1 = require("@prisma/client");
var prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var moviesData, movies, _i, moviesData_1, m, movie, city1, city2, venue1, venue2, screen1, screen2, createSeatsForScreen, screen1Seats, screen2Seats, show1, show2, _a, screen1Seats_1, seatId, _b, screen2Seats_1, seatId;
        var _this = this;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    console.log('🌱 Bawaal Seeding started...');
                    moviesData = [
                        { title: 'Batman: The Dark Knight', language: 'English', durationMins: 152 },
                        { title: 'Inception', language: 'English', durationMins: 148 },
                        { title: 'Pushpa 2: The Rule', language: 'Telugu', durationMins: 165 },
                    ];
                    movies = [];
                    _i = 0, moviesData_1 = moviesData;
                    _c.label = 1;
                case 1:
                    if (!(_i < moviesData_1.length)) return [3 /*break*/, 4];
                    m = moviesData_1[_i];
                    return [4 /*yield*/, prisma.movie.create({
                            data: __assign(__assign({}, m), { releaseDate: new Date() })
                        })];
                case 2:
                    movie = _c.sent();
                    movies.push(movie);
                    _c.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4:
                    console.log('✅ 3 Movies created!');
                    return [4 /*yield*/, prisma.city.create({ data: { name: 'Mumbai', state: 'MH' } })];
                case 5:
                    city1 = _c.sent();
                    return [4 /*yield*/, prisma.city.create({ data: { name: 'Delhi', state: 'DL' } })];
                case 6:
                    city2 = _c.sent();
                    return [4 /*yield*/, prisma.venue.create({
                            data: { name: 'PVR Andheri', address: 'Infinity Mall', cityId: city1.id }
                        })];
                case 7:
                    venue1 = _c.sent();
                    return [4 /*yield*/, prisma.venue.create({
                            data: { name: 'INOX Select City', address: 'Saket', cityId: city2.id }
                        })];
                case 8:
                    venue2 = _c.sent();
                    console.log('✅ Cities & Venues ready!');
                    return [4 /*yield*/, prisma.screen.create({
                            data: { name: 'IMAX Screen 1', venueId: venue1.id, totalRows: 10, totalCols: 10 }
                        })];
                case 9:
                    screen1 = _c.sent();
                    return [4 /*yield*/, prisma.screen.create({
                            data: { name: '4DX Screen 2', venueId: venue2.id, totalRows: 10, totalCols: 10 }
                        })];
                case 10:
                    screen2 = _c.sent();
                    createSeatsForScreen = function (screenId) { return __awaiter(_this, void 0, void 0, function () {
                        var seatIds, i, seat;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    seatIds = [];
                                    i = 1;
                                    _a.label = 1;
                                case 1:
                                    if (!(i <= 5)) return [3 /*break*/, 4];
                                    return [4 /*yield*/, prisma.seat.create({
                                            data: { screenId: screenId, rowLabel: 'A', colNumber: i, basePrice: 250.00 + (i * 10) } // Premium for middle seats
                                        })];
                                case 2:
                                    seat = _a.sent();
                                    seatIds.push(seat.id);
                                    _a.label = 3;
                                case 3:
                                    i++;
                                    return [3 /*break*/, 1];
                                case 4: return [2 /*return*/, seatIds];
                            }
                        });
                    }); };
                    return [4 /*yield*/, createSeatsForScreen(screen1.id)];
                case 11:
                    screen1Seats = _c.sent();
                    return [4 /*yield*/, createSeatsForScreen(screen2.id)];
                case 12:
                    screen2Seats = _c.sent();
                    console.log('✅ 10 Seats (A1 to A5) created across 2 screens!');
                    return [4 /*yield*/, prisma.show.create({
                            data: {
                                movieId: movies[0].id, screenId: screen1.id,
                                startTime: new Date(), endTime: new Date(Date.now() + 152 * 60000),
                                language: 'English', format: 'IMAX'
                            }
                        })];
                case 13:
                    show1 = _c.sent();
                    return [4 /*yield*/, prisma.show.create({
                            data: {
                                movieId: movies[1].id, screenId: screen2.id,
                                startTime: new Date(), endTime: new Date(Date.now() + 148 * 60000),
                                language: 'English', format: '4DX'
                            }
                        })];
                case 14:
                    show2 = _c.sent();
                    _a = 0, screen1Seats_1 = screen1Seats;
                    _c.label = 15;
                case 15:
                    if (!(_a < screen1Seats_1.length)) return [3 /*break*/, 18];
                    seatId = screen1Seats_1[_a];
                    return [4 /*yield*/, prisma.showSeat.create({ data: { showId: show1.id, seatId: seatId, status: 'AVAILABLE' } })];
                case 16:
                    _c.sent();
                    _c.label = 17;
                case 17:
                    _a++;
                    return [3 /*break*/, 15];
                case 18:
                    _b = 0, screen2Seats_1 = screen2Seats;
                    _c.label = 19;
                case 19:
                    if (!(_b < screen2Seats_1.length)) return [3 /*break*/, 22];
                    seatId = screen2Seats_1[_b];
                    return [4 /*yield*/, prisma.showSeat.create({ data: { showId: show2.id, seatId: seatId, status: 'AVAILABLE' } })];
                case 20:
                    _c.sent();
                    _c.label = 21;
                case 21:
                    _b++;
                    return [3 /*break*/, 19];
                case 22:
                    console.log('\n==================================================');
                    console.log('🎉 DB SEEDING COMPLETE! GRAB YOUR IDS BELOW:');
                    console.log('==================================================');
                    console.log("\n\uD83C\uDF7F SHOW 1: BATMAN (Mumbai - PVR Andheri)");
                    console.log("\uD83D\uDC49 SHOW_ID: ".concat(show1.id));
                    console.log("\uD83D\uDC49 AVAILABLE SEAT IDs (A1 to A5):");
                    screen1Seats.forEach(function (id, idx) { return console.log("   [A".concat(idx + 1, "] -> ").concat(id)); });
                    console.log("\n\uD83C\uDF7F SHOW 2: INCEPTION (Delhi - INOX Saket)");
                    console.log("\uD83D\uDC49 SHOW_ID: ".concat(show2.id));
                    console.log("\uD83D\uDC49 AVAILABLE SEAT IDs (A1 to A5):");
                    screen2Seats.forEach(function (id, idx) { return console.log("   [A".concat(idx + 1, "] -> ").concat(id)); });
                    console.log('==================================================');
                    return [2 /*return*/];
            }
        });
    });
}
main()
    .catch(function (e) { return console.error(e); })
    .finally(function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
    switch (_a.label) {
        case 0: return [4 /*yield*/, prisma.$disconnect()];
        case 1: return [2 /*return*/, _a.sent()];
    }
}); }); });
