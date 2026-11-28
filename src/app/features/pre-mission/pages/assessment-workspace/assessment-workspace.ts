
function resolveRegionCoordinates(regionName: string): { lat: number; lng: number } {
  const norm = (regionName || '').toLowerCase();
  if (norm.includes('an phú') || norm.includes('thủ đức')) return { lat: 10.8015, lng: 106.7455 };
  if (norm.includes('bình thạnh') || norm.includes('phường 25')) return { lat: 10.8012, lng: 106.7148 };
  if (norm.includes('linh trung')) return { lat: 10.8642, lng: 106.7765 };
  if (norm.includes('quận 1') || norm.includes('bến nghé')) return { lat: 10.7812, lng: 106.7005 };
  if (norm.includes('gò vấp')) return { lat: 10.8385, lng: 106.6657 };
  if (norm.includes('tân bình')) return { lat: 10.7981, lng: 106.6543 };
  return { lat: 10.7769, lng: 106.7009 };
}

import { DecimalPipe, Location } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { Subscription } from 'rxjs';
import { Auth } from '../../../../core/auth/auth';
import { ToastService } from '../../../../core/toast/toast.service';
import { droneReadinessLabel, resolveDroneReadiness } from '../../../../models/drone-management.models';
import {
  AssessmentTowerOption,
  PersonnelCandidate,
  PreMissionAssessment,
  SiteCheckItem,
  UavCandidate,
  UavTechnicalEligibility,
} from '../../../../models/pre-mission.models';
import { priorityColorClass, priorityLabel, statusColorClass, statusLabel, statusTone } from '../../../../shared/status/status';
import { NotificationsRealtime } from '../../../notifications/data-access/notifications-realtime';
import {
  needsTechnicianInspection,
  personnelReasonLabel,
  suitabilityLabel,
  technicalEligibilityLabel,
  technicalEligibilityTone,
  uavReasonLabel,
} from '../../data-access/candidate-labels';
import { PreMissionApi, RealtimeWeatherSnapshot, weatherSiteChecks } from '../../data-access/pre-mission-api';
import { describeHttpError, isStaleDataError } from '../../../../shared/errors/business-error-messages';
import {
  canManagePreMission,
  formatVietnamDateTime,
  formatVietnamDateTimeWithSeconds,
  MultiRolePrincipal,
} from '../../../../shared/utils';
import {
  buildLocalGisStyle,
  createLocalGisMap,
  DEFAULT_LOCAL_MAP_CENTER,
  DEFAULT_LOCAL_MAP_ZOOM,
  filterValidCoordinates,
  fitLocalGisBounds,
  LocalMapMode,
  resolveLocalMapMode,
  setLocalGisRouteLine,
} from '../../../../shared/gis/local-gis';

const SVG_NS = 'http://www.w3.org/2000/svg';

export type WorkspaceTab = 'overview' | 'site' | 'personnel' | 'uav';

export interface ParsedPersonnelFindings {
  readonly isJson: boolean;
  readonly role?: string;
  readonly inScope: boolean;
  readonly isActive: boolean;
  readonly hasValidRole: boolean;
  readonly hasInspectorRole: boolean;
  readonly hasBookingConflict: boolean;
  readonly rawText?: string;
}

@Component({
  selector: 'app-assessment-workspace',
  imports: [RouterLink, DecimalPipe, ReactiveFormsModule],
  templateUrl: './assessment-workspace.html',
  styleUrl: './assessment-workspace.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssessmentWorkspace implements AfterViewInit, OnDestroy {
  private readonly api = inject(PreMissionApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly location = inject(Location);
  private readonly realtime = inject(NotificationsRealtime);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private realtimeSub: Subscription | null = null;

  /** Tọa độ thực của các cột thuộc khu vực (từ `GET /towers?regionId=`) để vẽ phạm vi lên bản đồ. */
  protected readonly regionTowers = signal<readonly AssessmentTowerOption[]>([]);

  protected readonly scopeMapContainer = viewChild<ElementRef<HTMLDivElement>>('scopeMapContainer');
  protected readonly siteMapContainer = viewChild<ElementRef<HTMLDivElement>>('siteMapContainer');

  protected readonly currentUser = this.auth.user;
  /** Re-evaluate, cancel and create mission (MF02): SystemAdmin/Manager (hỗ trợ multi-role union). */
  protected readonly canManage = computed(() =>
    canManagePreMission(this.currentUser() as MultiRolePrincipal | null),
  );

  protected readonly item = signal<PreMissionAssessment | null>(null);
  protected readonly headcountForm = this.fb.nonNullable.group({
    inspectorCount: [1, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]],
    analystCount: [1, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]],
    technicianCount: [1, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]],
  });
  protected readonly statusColorClass = statusColorClass;
  protected readonly priorityLabel = priorityLabel;
  protected readonly priorityColorClass = priorityColorClass;

  protected roleVietnamese(role?: string | null): string {
    const r = (role || '').trim().toUpperCase();
    if (r.includes('INSPECT') || r.includes('PILOT')) return 'Phi công';
    if (r.includes('ANALYST')) return 'Chuyên viên phân tích';
    if (r.includes('TECH') || r.includes('MAINT')) return 'Kỹ thuật viên';
    return role || '—';
  }

  protected formatCandidateName(name?: string | null): string {
    const raw = (name || '').trim();
    if (!raw) return '—';
    // Shorten raw GUID fallback from backend for readability (full value stays in title tooltip)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
      return `ID ${raw.slice(0, 8).toUpperCase()}`;
    }
    return raw;
  }

  protected severityVietnamese(sev?: string | null): string {
    const s = (sev || '').trim().toLowerCase();
    if (s === 'high' || s === 'critical') return 'Cao';
    if (s === 'medium' || s === 'warning') return 'Trung bình';
    if (s === 'low' || s === 'info') return 'Thấp';
    return sev || '—';
  }

  protected severityColorClass(sev?: string | null): string {
    const s = (sev || '').trim().toLowerCase();
    if (s === 'high' || s === 'critical') return 'text-rose-600 font-medium';
    if (s === 'medium' || s === 'warning') return 'text-amber-700 font-medium';
    return 'text-slate-600 font-medium';
  }

  protected technicalColorClass(elig?: UavTechnicalEligibility): string {
    if (elig === 'ELIGIBLE') return 'text-emerald-600 font-medium';
    if (elig === 'CRITICAL') return 'text-rose-600 font-medium';
    if (elig === 'REQUIRES_INSPECTION' || elig === 'DEGRADED') return 'text-amber-700 font-medium';
    return 'text-slate-600 font-medium';
  }

  protected suitabilityColorClass(suit?: string | null): string {
    if (suit === 'SUITABLE') return 'text-emerald-600 font-medium';
    if (suit === 'SUITABLE_WITH_SPLIT') return 'text-amber-700 font-medium';
    if (suit === 'UNSUITABLE') return 'text-rose-600 font-medium';
    return 'text-slate-600 font-medium';
  }

  protected findingsSummaryList(f: ParsedPersonnelFindings, role: string): readonly { text: string; ok: boolean }[] {
    if (!f.isJson) {
      return [{ text: f.rawText || 'Đạt tiêu chuẩn sẵn sàng vận hành', ok: true }];
    }
    const items: { text: string; ok: boolean }[] = [];
    if (f.hasInspectorRole || role === 'INSPECTOR') {
      items.push({ text: 'Chứng chỉ bay UAV', ok: true });
    } else if (role === 'TECHNICIAN' || f.role === 'Technician' || f.role === 'MaintenanceTechnician') {
      items.push({ text: 'KTV bảo trì UAV', ok: true });
    } else if (role === 'ANALYST' || f.role === 'Analyst') {
      items.push({ text: 'CV phân tích AI', ok: true });
    }
    if (!f.hasValidRole) items.push({ text: 'Thiếu chuẩn vai trò', ok: false });
    items.push({ text: f.inScope ? 'Đúng địa bàn' : 'Khác địa bàn', ok: f.inScope });
    items.push({ text: f.isActive ? 'Hồ sơ hợp lệ' : 'Chưa kích hoạt', ok: f.isActive });
    if (f.hasBookingConflict) items.push({ text: 'Trùng lịch bay', ok: false });
    return items;
  }
  protected readonly error = signal('');
  protected readonly actionMessage = signal('');
  protected readonly isStaleConflict = signal(false);
  protected readonly busy = signal(false);
  protected readonly activeTab = signal<WorkspaceTab>('overview');

  // Bộ lọc ứng viên nhân sự
  protected readonly personnelSearch = signal('');
  protected readonly selectedRoleFilter = signal<'ALL' | 'INSPECTOR' | 'ANALYST' | 'TECHNICIAN'>('ALL');
  protected readonly onlyAvailableFilter = signal<boolean>(false);

  // Khí tượng (tham khảo, không thay đổi kết quả đánh giá của backend)
  protected readonly realtimeWeather = signal<RealtimeWeatherSnapshot | null>(null);
  protected readonly loadingWeather = signal(false);
  protected readonly siteChecks = computed<readonly SiteCheckItem[]>(() => {
    const w = this.realtimeWeather();
    return w ? weatherSiteChecks(w) : [];
  });

  protected formatDateTime(iso?: string | null, fallback = 'Chưa cập nhật'): string {
    return formatVietnamDateTime(iso, fallback);
  }

  protected formatDateTimeWithSeconds(iso?: string | null, fallback = 'Vừa cập nhật'): string {
    return formatVietnamDateTimeWithSeconds(iso, fallback);
  }

  protected droneReadinessLabelFor(uav: UavCandidate): string {
    const readiness = resolveDroneReadiness({
      readiness: uav.readiness,
      technicalHealth: uav.technicalHealth,
    });
    return droneReadinessLabel(readiness);
  }

  protected isDroneReady(uav: UavCandidate): boolean {
    return (
      resolveDroneReadiness({
        readiness: uav.readiness,
        technicalHealth: uav.technicalHealth,
      }) === 'Ready'
    );
  }

  // Bản đồ nội bộ (MapLibre + PMTiles / schematic fallback)
  private map: MapLibreMap | null = null;
  private markers: Marker[] = [];
  private routeCoords: [number, number][] = [];
  private appliedMapMode: LocalMapMode = 'pmtiles';
  private resizeObserver: ResizeObserver | null = null;
  private mapInitTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly currentMapType = signal<LocalMapMode>('pmtiles');

  protected readonly status = computed(() => (this.item()?.status ?? '').toUpperCase());
  protected readonly isReady = computed(() => this.status() === 'READY');
  protected readonly isEvaluating = computed(() => this.status() === 'EVALUATING');
  protected readonly isCancelled = computed(() => this.status() === 'CANCELLED');
  protected readonly isCompleted = computed(() => this.status() === 'COMPLETED' || !!this.item()?.completedMissionId);
  protected readonly isExpired = computed(() => {
    const a = this.item();
    if (!a) return false;
    if (this.status() === 'EXPIRED') return true;
    return !!a.validUntil && new Date(a.validUntil).getTime() < Date.now();
  });

  /** Cấu hình định mức nhân sự và giới hạn UAV được thiết lập từ hồ sơ (FindingsJson / BE-REQ-101). */
  protected readonly assessmentConfig = computed(() => {
    const current = this.item();
    return {
      reqInspectors: Math.max(1, current?.inspectorCount ?? 1),
      reqAnalysts: Math.max(1, current?.analystCount ?? 1),
      reqTechnicians: Math.max(1, current?.technicianCount ?? 1),
      maxDronesLimit: 1,
    };
  });

  /** Thống kê ứng viên đủ điều kiện theo vai trò (đúng quy tắc của backend). */
  protected readonly roleBreakdown = computed(() => {
    const candidates = this.item()?.personnelCandidates ?? [];
    const eligible = candidates.filter((c) => c.isEligible);
    const inspectors = eligible.filter((c) => c.role === 'INSPECTOR');
    const analysts = eligible.filter((c) => c.role === 'ANALYST');
    const technicians = eligible.filter((c) => c.role === 'TECHNICIAN');

    const cfg = this.assessmentConfig();
    const missingDetails: string[] = [];
    const missingRoles: string[] = [];
    const check = (label: string, count: number, required: number) => {
      if (count < required) {
        missingDetails.push(`${label}: thiếu ${required - count} người đủ điều kiện`);
        missingRoles.push(`${label} (${count}/${required})`);
      }
    };
    check('Phi công', inspectors.length, cfg.reqInspectors);
    check('Chuyên viên phân tích', analysts.length, cfg.reqAnalysts);
    check('Kỹ thuật viên', technicians.length, cfg.reqTechnicians);

    return {
      inspectors,
      analysts,
      technicians,
      allAvailable: eligible,
      reqInspectors: cfg.reqInspectors,
      reqAnalysts: cfg.reqAnalysts,
      reqTechnicians: cfg.reqTechnicians,
      hasAllThree: missingDetails.length === 0,
      missingDetails,
      missingRoles,
      totalEligible: inspectors.length + analysts.length + technicians.length,
      totalRequired: cfg.reqInspectors + cfg.reqAnalysts + cfg.reqTechnicians,
    };
  });

  /** Chỉ hồ sơ READY, còn hiệu lực và chưa dùng mới được tạo nhiệm vụ (`POST /{id}/create-mission`). */
  protected readonly canProceedToMf02 = computed(
    () => this.canManage() && this.isReady() && !this.isExpired() && !this.isCompleted() && !this.isCancelled(),
  );

  protected readonly failedConditions = computed(() => {
    const a = this.item();
    if (!a) return [];
    const list: { pillar: string; reason: string; actionTab: WorkspaceTab; actionLabel: string }[] = [];

    if (a.site.status !== 'PASS') {
      list.push({
        pillar: 'Mặt bằng',
        reason: a.site.reason || 'Mặt bằng hành lang chưa đạt điều kiện an toàn.',
        actionTab: 'site',
        actionLabel: 'Xem chi tiết mặt bằng',
      });
    }
    if (a.personnel.status !== 'PASS') {
      const roles = this.roleBreakdown();
      list.push({
        pillar: 'Nhân sự vận hành',
        reason: roles.missingDetails.length
          ? `${roles.missingDetails.join('; ')}.`
          : a.personnel.reason || 'Chưa đạt định mức nhân sự đang rảnh.',
        actionTab: 'personnel',
        actionLabel: 'Xem ứng viên nhân sự',
      });
    }
    if (a.uav.status !== 'PASS') {
      list.push({
        pillar: 'Phương tiện UAV',
        reason: a.uav.reason || 'Chưa có UAV Đạt chuẩn / Sẵn sàng trong khung giờ này. Vui lòng kiểm định tại Chi tiết UAV.',
        actionTab: 'uav',
        actionLabel: 'Xem danh sách thiết bị bay',
      });
    }
    return list;
  });

  protected formatManagerName(managerId?: string | null): string {
    if (!managerId) return 'Quản lý vận hành';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(managerId.trim())) {
      const u = this.auth.user();
      if (u && (u.id === managerId || u.email === managerId)) {
        return u.fullName || u.email || 'Quản lý vận hành';
      }
      return 'Quản lý vận hành';
    }
    return managerId;
  }

  protected readonly filteredPersonnel = computed(() => {
    let list: readonly PersonnelCandidate[] = this.item()?.personnelCandidates ?? [];

    if (this.onlyAvailableFilter()) {
      list = list.filter((p) => p.availabilityStatus === 'Available' && p.isEligible);
    }
    const roleFilter = this.selectedRoleFilter();
    if (roleFilter !== 'ALL') {
      list = list.filter((p) => p.role === roleFilter);
    }
    const q = this.personnelSearch().trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || p.rawRole.toLowerCase().includes(q) || p.findings.toLowerCase().includes(q),
      );
    }

    // Mặc định đẩy người đủ điều kiện & sẵn sàng lên đầu danh sách
    return [...list].sort((a, b) => {
      const aEligible = a.isEligible ? 1 : 0;
      const bEligible = b.isEligible ? 1 : 0;
      if (aEligible !== bEligible) return bEligible - aEligible;

      const aAvail = a.availabilityStatus === 'Available' ? 1 : 0;
      const bAvail = b.availabilityStatus === 'Available' ? 1 : 0;
      if (aAvail !== bAvail) return bAvail - aAvail;

      const aEligStatus = (a.eligibilityStatus || '').toUpperCase() === 'ELIGIBLE' ? 1 : 0;
      const bEligStatus = (b.eligibilityStatus || '').toUpperCase() === 'ELIGIBLE' ? 1 : 0;
      if (aEligStatus !== bEligStatus) return bEligStatus - aEligStatus;

      return (a.name || '').localeCompare(b.name || '', 'vi');
    });
  });

  /** Cột trong phạm vi hồ sơ kèm tọa độ (nếu có trong danh mục cột của khu vực), sắp đúng thứ tự tuyến bay. */
  protected readonly scopeTowers = computed(() => {
    const a = this.item();
    if (!a) return [];
    const byId = new Map(this.regionTowers().map((t) => [t.id, t]));
    return [...a.towers]
      .sort((x, y) => (x.sequence ?? 0) - (y.sequence ?? 0))
      .map((t) => {
        const info = byId.get(t.towerId);
        return {
          towerId: t.towerId,
          sequence: t.sequence,
          towerCode: t.towerCode || info?.towerCode || t.towerId,
          latitude: info?.latitude ?? null,
          longitude: info?.longitude ?? null,
        };
      });
  });

  protected readonly statusTone = statusTone;
  protected readonly statusLabel = statusLabel;

  // MF01 candidate reasons: `suitability` only describes scope; availability/technical come from separate fields.
  protected readonly uavReason = uavReasonLabel;
  protected readonly personnelReason = personnelReasonLabel;

  protected parseFindings(findings: string | undefined | null, operationalRole?: string): ParsedPersonnelFindings {
    if (!findings || !findings.trim()) {
      return {
        isJson: false,
        inScope: true,
        isActive: true,
        hasValidRole: true,
        hasInspectorRole: operationalRole === 'INSPECTOR',
        hasBookingConflict: false,
        rawText: 'Đạt chuẩn vai trò và căn cứ sẵn sàng',
      };
    }

    const trimmed = findings.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        return {
          isJson: true,
          role: typeof obj['role'] === 'string' ? obj['role'] : undefined,
          inScope: obj['inScope'] !== false,
          isActive: obj['isActive'] !== false,
          hasValidRole: obj['hasValidRole'] !== false,
          hasInspectorRole: obj['hasInspectorRole'] === true || operationalRole === 'INSPECTOR',
          hasBookingConflict: obj['hasBookingConflict'] === true,
          rawText: trimmed,
        };
      } catch {
        // Fall back to plain text
      }
    }

    return {
      isJson: false,
      inScope: true,
      isActive: true,
      hasValidRole: true,
      hasInspectorRole: operationalRole === 'INSPECTOR',
      hasBookingConflict: false,
      rawText: trimmed,
    };
  }
  protected readonly technicalLabel = technicalEligibilityLabel;
  protected readonly technicalTone = technicalEligibilityTone;
  protected readonly suitabilityText = suitabilityLabel;
  protected readonly needsInspection = needsTechnicianInspection;
  protected readonly eligibleUavCount = computed(() => (this.item()?.uavCandidates ?? []).filter((d) => d.isEligible).length);
  /** UAVs that a technician must inspect (no inspection valid at the planned start, failed or degraded). */
  protected readonly uavNeedingInspectionCount = computed(
    () => (this.item()?.uavCandidates ?? []).filter((d) => needsTechnicianInspection(d)).length,
  );

  protected readonly showCancelModal = signal<boolean>(false);
  protected readonly cancelReason = signal<string>('');

  constructor() {
    this.load();
    this.initRealtimeSubscription();

    effect(() => {
      const msg = this.actionMessage();
      if (msg) {
        this.toast.success(msg);
        untracked(() => this.actionMessage.set(''));
      }
    });

    effect(() => {
      const err = this.error();
      if (err && this.item()) {
        this.toast.error(err);
      }
    });

    effect(() => {
      const a = this.item();
      const tab = this.activeTab();
      const scopeEl = this.scopeMapContainer();
      this.regionTowers();
      if (a && tab === 'overview' && scopeEl) {
        this.scheduleMapUpdate(60);
      } else if (tab !== 'overview') {
        this.cleanupMap();
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.activeTab() === 'overview') {
      this.scheduleMapUpdate(150);
    }
  }

  ngOnDestroy(): void {
    const a = this.item();
    if (a?.id) this.realtime.leaveAssessment(a.id);
    this.realtimeSub?.unsubscribe();
    this.cleanupMap();
  }

  private initRealtimeSubscription(): void {
    this.realtimeSub = this.realtime.assessmentEvents$.subscribe((evt) => {
      const current = this.item();
      if (!current || (evt.assessmentId && evt.assessmentId !== current.id)) return;

      switch (evt.type) {
        case 'DroneInspectionCompleted': {
          if (this.canManage()) {
            this.api.reEvaluate(current.id).subscribe({
              next: (updated) => {
                this.applyAssessment(updated);
                if (evt.message) this.actionMessage.set(evt.message);
              },
            });
          }
          break;
        }
        case 'AssessmentStatusChanged':
        case 'AssessmentCompleted': {
          // Luôn tải lại hồ sơ từ backend để hiển thị kết quả chính thức.
          this.api.get(current.id).subscribe({
            next: (updated) => {
              this.applyAssessment(updated);
              if (evt.message) this.actionMessage.set(evt.message);
            },
          });
          break;
        }
      }
    });
  }

  protected load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Không tìm thấy mã định danh đánh giá.');
      return;
    }
    this.busy.set(true);
    this.isStaleConflict.set(false);
    this.error.set('');
    this.api.get(id).subscribe({
      next: (res) => {
        this.applyAssessment(res);
        this.realtime.joinAssessment(res.id);
        this.loadRegionTowers(res);
        this.busy.set(false);
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Đánh giá tiền nhiệm vụ không tồn tại hoặc bạn không có quyền truy cập.');
      },
    });
  }

  private applyAssessment(assessment: PreMissionAssessment): void {
    const currentHeadcount = this.headcountForm.getRawValue();
    this.item.set(assessment);
    this.headcountForm.setValue(
      {
        inspectorCount: assessment.inspectorCount ?? currentHeadcount.inspectorCount,
        analystCount: assessment.analystCount ?? currentHeadcount.analystCount,
        technicianCount: assessment.technicianCount ?? currentHeadcount.technicianCount,
      },
      { emitEvent: false },
    );
  }

  protected onPersonnelSearch(event: Event): void {
    this.personnelSearch.set((event.target as HTMLInputElement).value);
  }

  protected onOnlyAvailableChange(event: Event): void {
    this.onlyAvailableFilter.set((event.target as HTMLInputElement).checked);
  }

  protected onCancelReasonInput(event: Event): void {
    this.cancelReason.set((event.target as HTMLTextAreaElement).value);
  }

  /** Mở trang tạo hồ sơ mới với phạm vi sao chép từ hồ sơ hiện tại (dùng khi hồ sơ hết hạn). */
  protected goBack(): void {
    const id = this.item()?.id || this.route.snapshot.paramMap.get('id');
    if (id) {
      void this.router.navigate(['/pre-mission/new'], { queryParams: { assessmentId: id } });
    } else if (window.history.length > 1) {
      this.location.back();
    } else {
      void this.router.navigate(['/pre-mission']);
    }
  }

  private loadRegionTowers(a: PreMissionAssessment): void {
    if (!a.regionId) return;
    this.api.getRegionTowers(a.regionId).subscribe({
      next: (towers) => {
        this.regionTowers.set(towers);
        this.loadWeather();
      },
      error: () => this.regionTowers.set([]),
    });
  }

  private loadWeather(): void {
    const a = this.item();
    const regionName = a?.regionName || 'Khu vực quản lý lưới điện';
    const first = this.scopeTowers().find((t) => t.latitude != null && t.longitude != null);

    let lat = first?.latitude ?? null;
    let lng = first?.longitude ?? null;
    const towerCode = first?.towerCode;

    if (lat == null || lng == null) {
      const coords = resolveRegionCoordinates(regionName);
      lat = coords.lat;
      lng = coords.lng;
    }

    this.loadingWeather.set(true);
    this.api.getRealtimeWeather(lat, lng, regionName, towerCode).subscribe({
      next: (weather) => {
        this.realtimeWeather.set(weather);
        this.loadingWeather.set(false);
      },
      error: () => this.loadingWeather.set(false),
    });
  }

  protected reevaluate(): void {
    const a = this.item();
    if (!a || this.busy() || !this.canManage()) return;
    if (this.headcountForm.invalid) {
      this.headcountForm.markAllAsTouched();
      this.error.set('Số lượng Phi công, Chuyên viên phân tích và Kỹ thuật viên phải là số nguyên từ 1 trở lên.');
      return;
    }

    const headcount = this.headcountForm.getRawValue();
    this.busy.set(true);
    this.actionMessage.set('');
    this.error.set('');
    this.isStaleConflict.set(false);

    this.api.reEvaluate(a.id, headcount).subscribe({
      next: (updated) => {
        this.applyAssessment(updated);
        this.busy.set(false);
        this.actionMessage.set('Đã hoàn tất đánh giá lại tính khả thi và nguồn lực.');
      },
      error: (err: unknown) => {
        this.busy.set(false);
        if (isStaleDataError(err)) {
          this.isStaleConflict.set(true);
          this.error.set('Dữ liệu đánh giá đã bị thay đổi bởi phiên làm việc khác. Vui lòng bấm "Làm mới dữ liệu".');
        } else {
          this.error.set(describeHttpError(err, 'Không thể thực hiện đánh giá lại. Vui lòng thử lại sau.'));
        }
      },
    });
  }

  protected openCancelModal(): void {
    if (!this.item() || this.busy()) return;
    if (this.isCompleted()) {
      this.error.set('Không thể hủy đánh giá đã hoàn thành / tạo nhiệm vụ.');
      return;
    }
    if (this.isCancelled()) {
      this.error.set('Hồ sơ đánh giá đã bị hủy trước đó.');
      return;
    }
    if (this.isExpired()) {
      this.error.set('Hồ sơ đánh giá đã hết hạn, không thể hủy. Vui lòng lập hồ sơ mới nếu cần.');
      return;
    }
    this.cancelReason.set('');
    this.showCancelModal.set(true);
  }

  /** Reloads the assessment quietly (after an action failed because its state changed on the server). */
  private refreshItem(id: string): void {
    this.api.get(id).subscribe({ next: (updated) => this.applyAssessment(updated), error: () => undefined });
  }

  protected closeCancelModal(): void {
    if (this.busy()) return;
    this.showCancelModal.set(false);
  }

  protected executeCancel(): void {
    const a = this.item();
    if (!a || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.isStaleConflict.set(false);
    const reason = this.cancelReason().trim() || 'Người dùng hủy tại trang chi tiết';

    this.api.cancel(a.id, reason).subscribe({
      next: (updated) => {
        this.applyAssessment(updated);
        this.busy.set(false);
        this.showCancelModal.set(false);
        this.actionMessage.set(`Đã hủy bản đánh giá ${a.assessmentCode}.`);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        if (isStaleDataError(err)) {
          this.isStaleConflict.set(true);
          this.error.set('Dữ liệu đánh giá đã bị thay đổi bởi phiên làm việc khác. Vui lòng bấm "Làm mới dữ liệu".');
        } else {
          // ASSESSMENT_CANCELLED / ASSESSMENT_EXPIRED / ASSESSMENT_ALREADY_COMPLETED are final: reload to show the state.
          this.error.set(describeHttpError(err, 'Không thể hủy bản đánh giá.'));
          this.showCancelModal.set(false);
          this.refreshItem(a.id);
        }
      },
    });
  }

  protected setTab(tab: WorkspaceTab): void {
    this.activeTab.set(tab);
    if (tab === 'overview' || tab === 'site') {
      setTimeout(() => this.initOrUpdateMap(), 150);
      return;
    }
    this.cleanupMap();
  }

  protected setMapType(mode: LocalMapMode): void {
    this.currentMapType.set(mode);
    this.applyMapMode(mode);
  }

  private initOrUpdateMap(): void {
    if (this.activeTab() !== 'overview') {
      this.cleanupMap();
      return;
    }
    const container = this.scopeMapContainer()?.nativeElement;
    if (!container) return;

    if (this.map && this.map.getContainer() !== container) this.cleanupMap();

    const validTowers = this.getValidScopeTowers();
    const resolvedMode = resolveLocalMapMode(
      validTowers.map((t) => ({ latitude: t.latitude!, longitude: t.longitude! })),
      this.currentMapType(),
    );
    this.currentMapType.set(resolvedMode);

    if (!this.map) {
      this.appliedMapMode = resolvedMode;
      const map = createLocalGisMap(container, {
        mode: resolvedMode,
        center: DEFAULT_LOCAL_MAP_CENTER,
        zoom: DEFAULT_LOCAL_MAP_ZOOM,
        onFallbackToSchematic: () => this.handleSchematicFallback(),
      });
      if (!map) return;
      this.map = map;
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.map?.resize());
        this.resizeObserver.observe(container);
      }
    }

    this.map.resize();
    this.renderScopeOnMap();
  }

  private renderScopeOnMap(): void {
    const orderedTowers = this.getValidScopeTowers();
    const resolvedMode = resolveLocalMapMode(
      orderedTowers.map((t) => ({ latitude: t.latitude!, longitude: t.longitude! })),
      this.currentMapType(),
    );
    if (resolvedMode !== this.currentMapType()) {
      this.currentMapType.set(resolvedMode);
    }

    const coords: [number, number][] = orderedTowers.map((t) => [t.longitude!, t.latitude!]);
    this.routeCoords = coords;
    if (!this.map) return;

    this.applyMapMode(resolvedMode);
    this.clearMarkers();

    orderedTowers.forEach((tower, idx) => {
      const stepNumber = idx + 1;
      const isStart = idx === 0;
      const isEnd = orderedTowers.length > 1 && idx === orderedTowers.length - 1;
      const element = this.createScopePinElement(stepNumber, tower.towerCode, isStart, isEnd);
      const marker = new Marker({ element, anchor: 'left' }).setLngLat(coords[idx]).addTo(this.map!);
      this.markers.push(marker);
    });

    setLocalGisRouteLine(this.map, coords, { color: '#1d4f91', width: 3 });

    if (coords.length > 1) {
      // Mũi tên chỉ hướng bay tại trung điểm mỗi chặng từ cột i -> cột i+1
      for (let i = 0; i < coords.length - 1; i++) {
        const [lng1, lat1] = coords[i];
        const [lng2, lat2] = coords[i + 1];
        const midCoord: [number, number] = [(lng1 + lng2) / 2, (lat1 + lat2) / 2];
        const p1 = this.map.project([lng1, lat1]);
        const p2 = this.map.project([lng2, lat2]);
        const angleDeg = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
        const arrowEl = this.createDirectionArrowElement(angleDeg);
        const arrowMarker = new Marker({ element: arrowEl }).setLngLat(midCoord).addTo(this.map);
        this.markers.push(arrowMarker);
      }
    }

    if (coords.length) {
      fitLocalGisBounds(this.map, coords, 52, 16);
    }
  }

  protected refreshMap(): void {
    if (this.map) {
      this.map.resize();
      this.renderScopeOnMap();
    } else {
      this.initOrUpdateMap();
    }
  }

  /** Lọc bỏ an toàn cột có tọa độ hỏng để không làm lỗi hoặc mất toàn bộ bản đồ phạm vi. */
  private getValidScopeTowers() {
    return filterValidCoordinates(this.scopeTowers(), (t) => ({
      latitude: t.latitude,
      longitude: t.longitude,
    }));
  }

  private applyMapMode(mode: LocalMapMode): void {
    if (!this.map || this.appliedMapMode === mode) return;
    this.appliedMapMode = mode;
    this.map.setStyle(buildLocalGisStyle(mode));
    // setStyle xóa nguồn GeoJSON tuyến bay nên cần gắn lại sau khi style mới nạp xong.
    setLocalGisRouteLine(this.map, this.routeCoords, { color: '#1d4f91', width: 3 });
  }

  private handleSchematicFallback(): void {
    this.appliedMapMode = 'schematic';
    this.currentMapType.set('schematic');
    if (this.map && this.routeCoords.length > 1) {
      setLocalGisRouteLine(this.map, this.routeCoords, { color: '#1d4f91', width: 3 });
    }
  }

  private createScopePinElement(stepNumber: number, towerCode: string, isStart: boolean, isEnd: boolean): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'ws-map-pin-wrapper';
    wrapper.style.display = 'inline-flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '6px';

    const pin = document.createElement('span');
    pin.className = 'ws-map-tower-pin';
    if (isStart) pin.classList.add('is-start');
    else if (isEnd) pin.classList.add('is-end');
    pin.textContent = String(stepNumber);

    const label = document.createElement('span');
    label.className = 'ws-map-tower-label';
    let roleTag = '';
    if (isStart) roleTag = ' (Bắt đầu)';
    else if (isEnd) roleTag = ' (Kết thúc)';
    label.textContent = `${stepNumber}. ${towerCode}${roleTag}`;

    wrapper.appendChild(pin);
    wrapper.appendChild(label);
    return wrapper;
  }

  private createDirectionArrowElement(angleDeg: number): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'ws-map-dir-wrapper';
    wrapper.style.pointerEvents = 'none';

    const arrow = document.createElement('div');
    arrow.className = 'ws-map-dir-arrow';
    arrow.style.transform = `rotate(${angleDeg.toFixed(1)}deg)`;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M2 3.5L13.5 8L2 12.5L4.8 8L2 3.5Z');
    path.setAttribute('fill', '#1d4f91');
    path.setAttribute('stroke', '#ffffff');
    path.setAttribute('stroke-width', '1.2');
    path.setAttribute('stroke-linejoin', 'round');

    svg.appendChild(path);
    arrow.appendChild(svg);
    wrapper.appendChild(arrow);
    return wrapper;
  }

  private scheduleMapUpdate(delayMs: number): void {
    if (this.mapInitTimer !== null) clearTimeout(this.mapInitTimer);
    this.mapInitTimer = setTimeout(() => {
      this.mapInitTimer = null;
      this.initOrUpdateMap();
    }, delayMs);
  }

  private clearMarkers(): void {
    for (const marker of this.markers) marker.remove();
    this.markers = [];
  }

  private cleanupMap(): void {
    if (this.mapInitTimer !== null) {
      clearTimeout(this.mapInitTimer);
      this.mapInitTimer = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clearMarkers();
    if (!this.map) return;
    try {
      this.map.remove();
    } catch {
      // Bỏ qua nếu instance bản đồ đã bị hủy trước đó
    }
    this.map = null;
  }
}
