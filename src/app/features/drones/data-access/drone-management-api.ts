import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { unwrapApiData } from '../../../models/api.models';
import {
  ActiveFlightControllerDto,
  BasicTechnicalCheckRequest,
  CreateUavRequest,
  DroneTechnicalInspectionSummaryDto,
  GisDroneEstimationRequest,
  GisDroneEstimationResult,
  resolveDroneReadiness,
  SubmitUavInspectionRequest,
  UavInspectionRecord,
  UavRecord,
  UpdateUavRequest,
} from '../../../models/drone-management.models';
import { PairFlightControllerPayload } from '../../../models/flight-controller.models';
import { asRecord, readArray, readNumber, readOptionalString, readString } from '../../../shared/utils';

export interface DroneListFilters {
  readonly search?: string;
  readonly operationalStatus?: string;
  readonly technicalHealth?: string;
  readonly regionId?: string;
}

function timestampOf(iso?: string | null): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeInspectionRecord(raw: unknown, fallbackDroneId: string): UavInspectionRecord | null {
  const item = asRecord(raw);
  if (!item) return null;

  const id = readString(item, 'id');
  if (!id) return null;

  const status = readString(item, 'status', 'Unknown');
  const health = readString(item, 'health', 'Unknown');
  const explicitReadiness = readOptionalString(item, 'readiness');
  const readiness = resolveDroneReadiness({ readiness: explicitReadiness, health, status });
  const metrics = readArray(item['metrics']);
  const metricCount = readNumber(item, 'metricCount', metrics.length);
  const missingMetricCodes = new Set<string>();
  for (const code of readArray(item['missingMetrics'])) {
    if (typeof code === 'string' && code.trim()) missingMetricCodes.add(code.trim().toUpperCase());
  }
  for (const rawMetric of metrics) {
    const metric = asRecord(rawMetric);
    if (!metric || (metric['isRequired'] !== true && metric['critical'] !== true)) continue;
    if (typeof metric['numericValue'] === 'number' || typeof metric['boolValue'] === 'boolean') continue;
    if (readOptionalString(metric, 'valueText') || metric['passed'] === true) continue;
    const code = readString(metric, 'metricCode').toUpperCase();
    if (code) missingMetricCodes.add(code);
  }

  return {
    id,
    droneId: readString(item, 'droneId', fallbackDroneId),
    sourceType: readString(item, 'sourceType', 'manual'),
    conclusion: readString(item, 'conclusion', status === 'Passed' ? 'Passed' : 'Failed'),
    status,
    health,
    readiness,
    technicianName: readOptionalString(item, 'technicianName'),
    notes: readOptionalString(item, 'notes'),
    completedAt: readOptionalString(item, 'completedAt') ?? readOptionalString(item, 'inspectedAt') ?? readOptionalString(item, 'createdAt'),
    validUntil: readOptionalString(item, 'validUntil'),
    metricCount,
    missingMetricCodes: [...missingMetricCodes],
  };
}

function normalizeFlightController(raw: unknown): ActiveFlightControllerDto | null {
  const item = asRecord(raw);
  if (!item) return null;

  const uid = readString(item, 'flightControllerUid');
  if (!uid) return null;

  return {
    id: readString(item, 'id'),
    droneId: readString(item, 'droneId'),
    flightControllerUid: uid,
    boardIdentifier: readOptionalString(item, 'boardIdentifier'),
    firmwareName: readOptionalString(item, 'firmwareName'),
    firmwareVersion: readOptionalString(item, 'firmwareVersion'),
    pairedAt: readString(item, 'pairedAt'),
    unpairedAt: readOptionalString(item, 'unpairedAt'),
    lastSeenAt: readOptionalString(item, 'lastSeenAt'),
    isActive: item['isActive'] !== false,
  };
}

/**
 * Quản lý đội drone (`/drones`) và kiểm định kỹ thuật UAV (`/uavs/{droneId}/inspections`).
 */
@Injectable({
  providedIn: 'root',
})
export class DroneManagementApi {
  private readonly http = inject(HttpClient);
  private readonly apiBase = environment.apiBaseUrl;
  private readonly baseUrl = `${environment.apiBaseUrl}/drones`;

  /** `GET /drones?detailed=true` trả danh sách `UavDetailsDto`. */
  getDrones(filters: DroneListFilters = {}): Observable<readonly UavRecord[]> {
    let params = new HttpParams().set('detailed', 'true');
    if (filters.search) params = params.set('search', filters.search);
    if (filters.operationalStatus) params = params.set('operationalStatus', filters.operationalStatus);
    if (filters.technicalHealth) params = params.set('technicalHealth', filters.technicalHealth);
    if (filters.regionId) params = params.set('regionId', filters.regionId);

    return this.http.get<unknown>(this.baseUrl, { params }).pipe(
      map((res) => {
        const data = unwrapApiData<unknown>(res);
        return Array.isArray(data) ? (data as UavRecord[]) : [];
      }),
    );
  }

  getDrone(droneId: string): Observable<UavRecord> {
    return this.http.get<unknown>(`${this.baseUrl}/${droneId}`).pipe(map((res) => unwrapApiData<UavRecord>(res)));
  }

  createDrone(payload: CreateUavRequest): Observable<UavRecord> {
    return this.http.post<unknown>(this.baseUrl, payload).pipe(map((res) => unwrapApiData<UavRecord>(res)));
  }

  updateDrone(droneId: string, payload: UpdateUavRequest): Observable<UavRecord> {
    return this.http.put<unknown>(`${this.baseUrl}/${droneId}`, payload).pipe(map((res) => unwrapApiData<UavRecord>(res)));
  }

  deleteDrone(droneId: string): Observable<void> {
    return this.http.delete<unknown>(`${this.baseUrl}/${droneId}`).pipe(map(() => void 0));
  }

  /**
   * `POST /api/v1/uavs/{droneId}/inspections` (`BE-REQ-101`): chỉ `SystemAdmin` & `Technician`.
   * Không gửi `preMissionAssessmentId` vì BIST đã tách khỏi MF01.
   */
  submitUavInspection(droneId: string, payload: SubmitUavInspectionRequest): Observable<UavInspectionRecord> {
    const body = {
      sourceType: payload.sourceType,
      conclusion: payload.conclusion,
      notes: payload.notes?.trim() || null,
      metrics: payload.metrics.map((m) => ({ ...m })),
      missingMetricCodes: payload.missingMetricCodes,
    };

    return this.http.post<unknown>(`${this.apiBase}/uavs/${droneId}/inspections`, body).pipe(
      map((res) => {
        const normalized = normalizeInspectionRecord(unwrapApiData<unknown>(res), droneId);
        if (!normalized) throw new Error('Invalid inspection response');
        return normalized;
      }),
    );
  }

  /** `GET /api/v1/uavs/{droneId}/inspections/latest` (`Analyst` nhận `403`). */
  getLatestUavInspection(droneId: string): Observable<UavInspectionRecord | null> {
    return this.http
      .get<unknown>(`${this.apiBase}/uavs/${droneId}/inspections/latest`)
      .pipe(map((res) => normalizeInspectionRecord(unwrapApiData<unknown>(res), droneId)));
  }

  /** `GET /api/v1/drones/{id}/technical-inspections` — luôn chuẩn hóa và sắp xếp mới nhất lên đầu (`DESC`). */
  getTechnicalInspections(droneId: string, page = 1, pageSize = 20): Observable<readonly UavInspectionRecord[]> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<unknown>(`${this.baseUrl}/${droneId}/technical-inspections`, { params }).pipe(
      map((res) => {
        const raw = unwrapApiData<unknown>(res);
        const list = Array.isArray(raw) ? raw : readArray(asRecord(raw)?.['items']);
        const records: UavInspectionRecord[] = [];
        for (const item of list) {
          const parsed = normalizeInspectionRecord(item, droneId);
          if (parsed) records.push(parsed);
        }
        return records.sort((a, b) => timestampOf(b.completedAt) - timestampOf(a.completedAt));
      }),
    );
  }

  /** `GET /api/v1/drones/{droneId}/flight-controller`. */
  getActiveFlightController(droneId: string): Observable<ActiveFlightControllerDto | null> {
    return this.http
      .get<unknown>(`${this.baseUrl}/${droneId}/flight-controller`)
      .pipe(map((res) => normalizeFlightController(unwrapApiData<unknown>(res))));
  }

  /** `POST /api/v1/drones/{droneId}/flight-controller` (`SystemAdmin` & `Technician`). */
  pairFlightController(droneId: string, payload: PairFlightControllerPayload): Observable<ActiveFlightControllerDto> {
    return this.http.post<unknown>(`${this.baseUrl}/${droneId}/flight-controller`, payload).pipe(
      map((res) => {
        const parsed = normalizeFlightController(unwrapApiData<unknown>(res));
        if (parsed) return parsed;
        return {
          id: '',
          droneId,
          flightControllerUid: payload.flightControllerUid,
          boardIdentifier: payload.boardIdentifier ?? null,
          firmwareName: payload.firmwareName ?? null,
          firmwareVersion: payload.firmwareVersion ?? null,
          pairedAt: new Date().toISOString(),
          isActive: true,
        };
      }),
    );
  }

  /** `DELETE /api/v1/drones/{droneId}/flight-controller` (`SystemAdmin` & `Technician`). */
  unpairFlightController(droneId: string): Observable<void> {
    return this.http.delete<unknown>(`${this.baseUrl}/${droneId}/flight-controller`).pipe(map(() => void 0));
  }

  submitBasicTechnicalCheck(droneId: string, payload: BasicTechnicalCheckRequest): Observable<DroneTechnicalInspectionSummaryDto> {
    return this.http
      .post<unknown>(`${this.baseUrl}/${droneId}/basic-technical-check`, payload)
      .pipe(map((res) => unwrapApiData<DroneTechnicalInspectionSummaryDto>(res)));
  }

  estimateGisScope(payload: GisDroneEstimationRequest): Observable<GisDroneEstimationResult> {
    return this.http
      .post<unknown>(`${this.baseUrl}/estimate-gis-scope`, payload)
      .pipe(map((res) => unwrapApiData<GisDroneEstimationResult>(res)));
  }
}
