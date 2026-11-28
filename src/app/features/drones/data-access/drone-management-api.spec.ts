import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../../environments/environment';
import { DroneManagementApi } from './drone-management-api';

describe('DroneManagementApi (FE-REQ-101)', () => {
  let service: DroneManagementApi;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DroneManagementApi, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DroneManagementApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('fetches the detailed drone list as UavDetailsDto', () => {
    const mockDrones = [
      { id: 'd-1', code: 'UAV-001', name: 'Surveyor 1', operationalStatus: 'Available', technicalHealth: 'Healthy' },
    ];
    let codes: string[] = [];
    service.getDrones({ operationalStatus: 'InUse' }).subscribe((drones) => (codes = drones.map((d) => d.code)));

    const req = httpMock.expectOne((r) => r.url === `${environment.apiBaseUrl}/drones`);
    expect(req.request.params.get('detailed')).toBe('true');
    expect(req.request.params.get('operationalStatus')).toBe('InUse');
    req.flush(mockDrones);
    expect(codes).toEqual(['UAV-001']);
  });

  it('submits manual/FC BIST inspection to POST /uavs/{droneId}/inspections without preMissionAssessmentId', () => {
    let resultReadiness = '';
    service
      .submitUavInspection('drone-syn-1', {
        sourceType: 'manual',
        conclusion: 'Passed',
        notes: 'Kiểm định thủ công đạt chuẩn',
        metrics: [
          {
            metricCode: 'BATTERY_PERCENT',
            subsystem: 'Power',
            numericValue: 96,
            unit: '%',
            passed: true,
            isRequired: true,
          },
        ],
      })
      .subscribe((res) => {
        resultReadiness = res.readiness;
      });

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/uavs/drone-syn-1/inspections`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.sourceType).toBe('manual');
    expect(req.request.body.conclusion).toBe('Passed');
    expect(req.request.body.notes).toBe('Kiểm định thủ công đạt chuẩn');
    expect(req.request.body.metrics.length).toBe(1);
    expect('preMissionAssessmentId' in req.request.body).toBe(false);

    req.flush({
      id: 'insp-1',
      droneId: 'drone-syn-1',
      sourceType: 'manual',
      conclusion: 'Passed',
      status: 'Passed',
      health: 'Healthy',
      readiness: 'Ready',
      completedAt: '2026-11-27T08:00:00Z',
      notes: 'Kiểm định thủ công đạt chuẩn',
      metricCount: 1,
    });

    expect(resultReadiness).toBe('Ready');
  });

  it('fetches latest UAV inspection from GET /uavs/{droneId}/inspections/latest and handles malformed payload safely', () => {
    let latestId: string | null = null;
    let latestReadiness = '';
    service.getLatestUavInspection('drone-syn-1').subscribe((res) => {
      latestId = res?.id ?? null;
      latestReadiness = res?.readiness ?? '';
    });

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/uavs/drone-syn-1/inspections/latest`);
    expect(req.request.method).toBe('GET');
    req.flush({
      data: {
        id: 'insp-latest',
        droneId: 'drone-syn-1',
        status: 'Failed',
        health: 'Critical',
        completedAt: '2026-11-27T09:30:00Z',
        notes: null,
      },
    });

    expect(latestId).toBe('insp-latest');
    expect(latestReadiness).toBe('MaintenanceRequired');
  });

  it('fetches technical inspection history sorted newest-first (DESC) and ignores null/malformed entries', () => {
    let ids: string[] = [];
    service.getTechnicalInspections('drone-syn-1').subscribe((list) => {
      ids = list.map((item) => item.id);
    });

    const req = httpMock.expectOne((r) => r.url === `${environment.apiBaseUrl}/drones/drone-syn-1/technical-inspections`);
    expect(req.request.method).toBe('GET');
    req.flush([
      { id: 'older', status: 'Passed', health: 'Healthy', completedAt: '2026-11-20T01:00:00Z', metricCount: 4 },
      null,
      { id: 'newest', status: 'Failed', health: 'Critical', completedAt: '2026-11-27T10:00:00Z', metricCount: 4 },
      { id: 'middle', status: 'Passed', health: 'Healthy', completedAt: '2026-11-25T05:00:00Z', metricCount: 4 },
    ]);

    expect(ids).toEqual(['newest', 'middle', 'older']);
  });

  it('pairs and unpairs Flight Controller via POST and DELETE /drones/{droneId}/flight-controller', () => {
    let pairedUid = '';
    service
      .pairFlightController('drone-syn-1', {
        flightControllerUid: 'FC-SYN-001',
        boardIdentifier: 'SYN-BOARD',
        firmwareName: 'Betaflight',
        firmwareVersion: '4.5.1',
      })
      .subscribe((res) => (pairedUid = res.flightControllerUid));

    const postReq = httpMock.expectOne(`${environment.apiBaseUrl}/drones/drone-syn-1/flight-controller`);
    expect(postReq.request.method).toBe('POST');
    expect(postReq.request.body.flightControllerUid).toBe('FC-SYN-001');
    postReq.flush({
      id: 'fc-bind-1',
      droneId: 'drone-syn-1',
      flightControllerUid: 'FC-SYN-001',
      pairedAt: '2026-11-27T07:00:00Z',
      isActive: true,
    });
    expect(pairedUid).toBe('FC-SYN-001');

    let unpaired = false;
    service.unpairFlightController('drone-syn-1').subscribe(() => (unpaired = true));
    const deleteReq = httpMock.expectOne(`${environment.apiBaseUrl}/drones/drone-syn-1/flight-controller`);
    expect(deleteReq.request.method).toBe('DELETE');
    deleteReq.flush({});
    expect(unpaired).toBe(true);
  });

  it('propagates 403 Forbidden error from technical inspections endpoint', () => {
    let errorStatus = 0;
    service.getTechnicalInspections('drone-syn-1').subscribe({
      error: (err: HttpErrorResponse) => {
        errorStatus = err.status;
      },
    });

    const req = httpMock.expectOne((r) => r.url === `${environment.apiBaseUrl}/drones/drone-syn-1/technical-inspections`);
    req.flush({ errorCode: 'DRONE_ACCESS_DENIED' }, { status: 403, statusText: 'Forbidden' });
    expect(errorStatus).toBe(403);
  });

  it('requests the GIS scope drone estimation', () => {
    let suitability = '';
    service.estimateGisScope({ corridorLengthKm: 5, assetCount: 10 }).subscribe((res) => (suitability = res.drones[0].suitability));

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/drones/estimate-gis-scope`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ corridorLengthKm: 5, assetCount: 10 });
    req.flush({
      corridorLengthKm: 5,
      assetCount: 10,
      estimatedMissionDurationMinutes: 38.3,
      averageSpeedKmh: 36,
      reserveBatteryPercent: 20,
      inspectionMinutesPerAsset: 3,
      drones: [
        {
          droneId: 'd-1',
          droneCode: 'UAV-001',
          droneName: 'Surveyor 1',
          model: 'M300',
          category: 'Hexacopter',
          operationalStatus: 'Available',
          technicalHealth: 'Healthy',
          flightEnduranceMinutes: 45,
          operationalRangeKm: 20,
          effectiveFlightMinutes: 36,
          maxCoverageDistanceKm: 21.6,
          estimatedFlightsNeeded: 1,
          estimatedDronesNeeded: 1,
          suitability: 'SUITABLE',
          isAvailable: true,
          isTechnicallyReady: true,
          recommendation: 'Đạt',
        },
      ],
    });
    expect(suitability).toBe('SUITABLE');
  });
});
