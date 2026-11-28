import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { finalize, Subscription } from 'rxjs';
import { AssessmentTowerOption, RegionOption, SelectablePreMissionDrone } from '../../../../models/pre-mission.models';
import { droneReadinessLabel } from '../../../../models/drone-management.models';
import { MissionTargetSelection } from '../../../missions/data-access/mission-target-selection';
import { isValidGuid, PreMissionApi } from '../../data-access/pre-mission-api';
import { describeHttpError } from '../../../../shared/errors/business-error-messages';
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
import { IdempotencyKeyTracker } from '../../../../shared/idempotency/idempotency-key';

function formatDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dateWindowValidator(control: AbstractControl): ValidationErrors | null {
  const start = control.get('plannedStart')?.value;
  const end = control.get('plannedEnd')?.value;
  if (!start || !end) return null;
  return new Date(end) <= new Date(start) ? { endBeforeStart: true } : null;
}

function notInPastValidator(control: AbstractControl): ValidationErrors | null {
  const start = control.get('plannedStart')?.value;
  if (!start) return null;
  // Cho phép lệch đồng hồ 15 phút.
  return new Date(start).getTime() < Date.now() - 15 * 60 * 1000 ? { startInPast: true } : null;
}

/**
 * Lập hồ sơ đánh giá tiền khả thi (MF01): chọn khu vực, các cột điện cần kiểm tra và khung giờ bay dự kiến.
 * Gửi `POST /pre-mission-assessments` với `{ regionId, plannedStart, plannedEnd, towerIds }`.
 */
@Component({
  selector: 'app-assessment-create',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './assessment-create.html',
  styleUrl: './assessment-create.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssessmentCreate implements AfterViewInit, OnDestroy {
  private readonly api = inject(PreMissionApi);
  private readonly targetSelection = inject(MissionTargetSelection);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private regionDronesRequest?: Subscription;

  private readonly mapContainer = viewChild<ElementRef<HTMLDivElement>>('createMapContainer');
  private map: MapLibreMap | null = null;
  private markers: Marker[] = [];
  private routeCoords: [number, number][] = [];
  private appliedMapMode: LocalMapMode = 'pmtiles';
  private resizeObserver: ResizeObserver | null = null;
  private mapTimers: ReturnType<typeof setTimeout>[] = [];

  protected readonly currentMapType = signal<LocalMapMode>('pmtiles');
  protected readonly draggedIndex = signal<number | null>(null);

  protected readonly busy = signal(false);
  protected readonly loadingTowers = signal(false);
  protected readonly loadingDrones = signal(false);
  protected readonly error = signal('');

  protected readonly regions = signal<readonly RegionOption[]>([]);
  protected readonly towers = signal<readonly AssessmentTowerOption[]>([]);
  protected readonly selectedTowerIds = signal<readonly string[]>([]);
  protected readonly regionDrones = signal<readonly SelectablePreMissionDrone[]>([]);
  protected readonly selectedDroneIds = signal<readonly string[]>([]);
  protected readonly towerSearch = signal('');

  /**
   * Khóa idempotency: giữ nguyên khi gửi lại cùng nội dung (tránh tạo trùng hồ sơ), đổi khóa mới khi vùng, khung giờ
   * hoặc danh sách cột thay đổi (backend trả `409 IDEMPOTENCY_KEY_REUSED` nếu dùng lại khóa cho nội dung khác).
   */
  private readonly idempotency = new IdempotencyKeyTracker();

  protected readonly form = this.fb.nonNullable.group(
    {
      regionId: ['', [Validators.required]],
      plannedStart: [formatDatetimeLocal(new Date(Date.now() + 60 * 60 * 1000)), [Validators.required]],
      plannedEnd: [formatDatetimeLocal(new Date(Date.now() + 4 * 60 * 60 * 1000)), [Validators.required]],
      inspectorCount: [1, [Validators.required, Validators.min(1), Validators.max(10)]],
      analystCount: [1, [Validators.required, Validators.min(1), Validators.max(10)]],
      technicianCount: [1, [Validators.required, Validators.min(1), Validators.max(10)]],
      maxDronesLimit: [1, [Validators.required, Validators.min(1), Validators.max(5)]],
    },
    { validators: [dateWindowValidator, notInPastValidator] },
  );

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly cleanInspectors = computed(() => Math.max(1, Number(this.formValue().inspectorCount) || 1));
  protected readonly cleanAnalysts = computed(() => Math.max(1, Number(this.formValue().analystCount) || 1));
  protected readonly cleanTechnicians = computed(() => Math.max(1, Number(this.formValue().technicianCount) || 1));
  protected readonly cleanMaxDrones = computed(() => Math.max(1, Number(this.formValue().maxDronesLimit) || 1));

  protected readonly totalRequiredPersonnel = computed(() => {
    return this.cleanInspectors() + this.cleanAnalysts() + this.cleanTechnicians();
  });

  protected readonly selectedRegion = computed(() => {
    const id = this.formValue().regionId;
    return this.regions().find((r) => r.id === id) ?? null;
  });

  protected readonly plannedStartValue = computed(() => this.formValue().plannedStart ?? '');
  protected readonly plannedEndValue = computed(() => this.formValue().plannedEnd ?? '');

  protected readonly filteredTowers = computed(() => {
    const q = this.towerSearch().trim().toLowerCase();
    const list = this.towers();
    if (!q) return list;
    return list.filter((t) => t.towerCode.toLowerCase().includes(q) || (t.address ?? '').toLowerCase().includes(q));
  });

  protected readonly selectedTowers = computed(() => {
    const byId = new Map(this.towers().map((t) => [t.id, t]));
    return this.selectedTowerIds()
      .map((id) => byId.get(id))
      .filter((t): t is AssessmentTowerOption => !!t);
  });

  constructor() {
    this.api
      .getRegions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.regions.set(list),
        error: () => this.error.set('Không thể tải danh sách khu vực.'),
      });

    const sourceId = this.route.snapshot.queryParamMap.get('assessmentId');
    if (sourceId && isValidGuid(sourceId)) {
      this.prefillFromAssessment(sourceId);
    } else {
      // Cột đã chọn trên bản đồ GIS: tự chọn khu vực của cột đầu tiên.
      const gisRegionId = this.targetSelection.selected().find((t) => t.regionId)?.regionId;
      if (gisRegionId) {
        this.form.controls.regionId.setValue(gisRegionId);
        this.loadTowers(gisRegionId);
        this.loadRegionDrones(gisRegionId);
      }
    }
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    this.cleanupMap();
  }

  protected onRegionSelect(event: Event): void {
    const regionId = (event.target as HTMLSelectElement).value;
    this.form.controls.regionId.setValue(regionId);
    this.form.controls.regionId.markAsTouched();
    this.selectedTowerIds.set([]);
    this.selectedDroneIds.set([]);
    this.loadTowers(regionId);
    this.loadRegionDrones(regionId);
  }

  protected isDroneSelected(id: string): boolean {
    return this.selectedDroneIds().includes(id);
  }

  protected toggleDrone(drone: SelectablePreMissionDrone): void {
    // Chỉ cho chọn UAV ở trạng thái Đạt chuẩn / Sẵn sàng (FR-003).
    if (drone.readiness !== 'Ready' || drone.regionId !== this.form.controls.regionId.value) return;
    this.selectedDroneIds.update((ids) =>
      ids.includes(drone.id) ? ids.filter((x) => x !== drone.id) : [...ids, drone.id],
    );
  }

  protected droneReadinessText(drone: SelectablePreMissionDrone): string {
    return droneReadinessLabel(drone.readiness);
  }

  protected onTowerSearch(event: Event): void {
    this.towerSearch.set((event.target as HTMLInputElement).value);
  }

  protected isTowerSelected(id: string): boolean {
    return this.selectedTowerIds().includes(id);
  }

  protected getTowerSequence(id: string): number | null {
    const idx = this.selectedTowerIds().indexOf(id);
    return idx >= 0 ? idx + 1 : null;
  }

  protected toggleTower(id: string): void {
    this.selectedTowerIds.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    this.renderMap(false);
  }

  protected selectAllFiltered(): void {
    const current = new Set(this.selectedTowerIds());
    const added = this.filteredTowers()
      .map((t) => t.id)
      .filter((id) => !current.has(id));
    this.selectedTowerIds.set([...this.selectedTowerIds(), ...added]);
    this.renderMap(true);
  }

  protected clearSelection(): void {
    this.selectedTowerIds.set([]);
    this.renderMap(false);
  }

  protected moveTower(index: number, direction: 'up' | 'down'): void {
    const current = [...this.selectedTowerIds()];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= current.length) return;
    const temp = current[index];
    current[index] = current[targetIndex];
    current[targetIndex] = temp;
    this.selectedTowerIds.set(current);
    this.renderMap(false);
  }

  protected removeSelectedTower(id: string): void {
    this.selectedTowerIds.update((ids) => ids.filter((x) => x !== id));
    this.renderMap(false);
  }

  protected reverseSequence(): void {
    const current = [...this.selectedTowerIds()];
    current.reverse();
    this.selectedTowerIds.set(current);
    this.renderMap(false);
  }

  protected onDragStart(index: number, event: DragEvent): void {
    this.draggedIndex.set(index);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  protected onDrop(targetIndex: number, event: DragEvent): void {
    event.preventDefault();
    const sourceIndex = this.draggedIndex();
    this.draggedIndex.set(null);
    if (sourceIndex === null || sourceIndex === targetIndex) return;
    const current = [...this.selectedTowerIds()];
    const [removed] = current.splice(sourceIndex, 1);
    current.splice(targetIndex, 0, removed);
    this.selectedTowerIds.set(current);
    this.renderMap(false);
  }

  protected blockInvalidNumberKeys(event: KeyboardEvent): void {
    if (['-', '+', 'e', 'E', '.'].includes(event.key)) {
      event.preventDefault();
    }
  }

  protected onQuotaInput(
    name: 'inspectorCount' | 'analystCount' | 'technicianCount' | 'maxDronesLimit',
    min = 1,
    max = 10,
  ): void {
    const control = this.form.get(name);
    if (!control) return;
    const raw = control.value;
    const num = parseInt(String(raw), 10);
    if (Number.isNaN(num) || num < min) {
      control.setValue(min);
    } else if (num > max) {
      control.setValue(max);
    } else {
      control.setValue(num);
    }
    control.markAsDirty();
  }

  protected incrementQuota(name: 'inspectorCount' | 'analystCount' | 'technicianCount' | 'maxDronesLimit', max = 10): void {
    const control = this.form.get(name);
    if (!control) return;
    const current = Number(control.value) || 1;
    if (current < max) {
      control.setValue(current + 1);
      control.markAsDirty();
    }
  }

  protected decrementQuota(name: 'inspectorCount' | 'analystCount' | 'technicianCount' | 'maxDronesLimit', min = 1): void {
    const control = this.form.get(name);
    if (!control) return;
    const current = Number(control.value) || 1;
    if (current > min) {
      control.setValue(current - 1);
      control.markAsDirty();
    }
  }

  protected submit(): void {
    this.error.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Thông tin biểu mẫu không hợp lệ. Vui lòng kiểm tra lại khung giờ và định mức nhân sự / UAV (tối thiểu 1).');
      return;
    }
    const towerIds = [...this.selectedTowerIds()];
    if (!towerIds.length) {
      this.error.set('Vui lòng chọn ít nhất một cột điện trong phạm vi đánh giá.');
      return;
    }
    const raw = this.form.getRawValue();
    // `datetime-local` values are local time; the API sends them as ISO-8601 UTC (`toISOString()`, with `Z`).
    const scope = {
      regionId: raw.regionId,
      plannedStart: raw.plannedStart,
      plannedEnd: raw.plannedEnd,
      towerIds,
      inspectorCount: raw.inspectorCount,
      analystCount: raw.analystCount,
      technicianCount: raw.technicianCount,
      droneIds: [...this.selectedDroneIds()],
      maxDronesLimit: raw.maxDronesLimit,
    };
    this.busy.set(true);
    this.api
      .create({ ...scope, idempotencyKey: this.idempotency.keyFor(scope) })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: (created) => {
          this.targetSelection.clear();
          void this.router.navigate(['/pre-mission', created.id]);
        },
        error: (err: unknown) =>
          this.error.set(
            describeHttpError(err, 'Không thể tạo đánh giá tiền nhiệm vụ. Vui lòng kiểm tra lại phạm vi và thời gian.'),
          ),
      });
  }

  protected setMapType(mode: LocalMapMode): void {
    this.currentMapType.set(mode);
    this.applyMapMode(mode);
  }

  protected refreshMap(): void {
    if (!this.map) {
      this.initMap();
      return;
    }
    this.scheduleMapTask(() => {
      this.map?.resize();
      this.fitMapToBounds();
    }, 50);
  }

  private fitMapToBounds(): void {
    if (!this.map) return;
    const validTowers = this.getValidTowers();
    if (!validTowers.length) {
      fitLocalGisBounds(this.map, [], 36, 16);
      return;
    }

    const selectedIds = this.selectedTowerIds();
    const byId = new Map(validTowers.map((t) => [t.id, t]));
    const targetTowers = selectedIds.length
      ? selectedIds.map((id) => byId.get(id)).filter((t): t is AssessmentTowerOption => !!t)
      : validTowers;
    const coords: [number, number][] = targetTowers.map((t) => [t.longitude, t.latitude]);
    fitLocalGisBounds(this.map, coords, 36, 16);
  }

  private loadTowers(regionId: string, preselect: readonly string[] = []): void {
    this.towers.set([]);
    if (!regionId) {
      this.renderMap(true);
      return;
    }
    this.loadingTowers.set(true);
    this.api
      .getRegionTowers(regionId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loadingTowers.set(false)),
      )
      .subscribe({
        next: (list) => {
          this.towers.set(list);
          const available = new Set(list.map((t) => t.id));
          // Cột đã chọn trên bản đồ GIS (nếu có) được chọn sẵn.
          const fromGis = this.targetSelection.selected().map((t) => t.towerId);
          const wanted = [...preselect, ...fromGis].filter((id, i, all) => available.has(id) && all.indexOf(id) === i);
          if (wanted.length) this.selectedTowerIds.set(wanted);
          this.scheduleMapTask(() => {
            this.map?.resize();
            this.renderMap(true);
          }, 100);
        },
        error: () => this.error.set('Không thể tải danh sách cột điện của khu vực.'),
      });
  }

  private loadRegionDrones(regionId: string): void {
    this.regionDronesRequest?.unsubscribe();
    this.regionDrones.set([]);
    if (!regionId || typeof this.api.getRegionDrones !== 'function') return;
    this.loadingDrones.set(true);
    this.regionDronesRequest = this.api
      .getRegionDrones(regionId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loadingDrones.set(false)),
      )
      .subscribe({
        next: (list) => {
          const matchingRegion = list.filter((drone) => drone.regionId === regionId);
          this.regionDrones.set(matchingRegion);
        },
        error: () => this.regionDrones.set([]),
      });
  }

  /** Tạo lại hồ sơ từ một hồ sơ cũ (ví dụ hồ sơ đã hết hạn): kế thừa khu vực và danh sách cột. */
  private prefillFromAssessment(id: string): void {
    this.api
      .get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (a) => {
          this.form.controls.regionId.setValue(a.regionId);
          if (typeof a.inspectorCount === 'number' && a.inspectorCount >= 1) {
            this.form.controls.inspectorCount.setValue(a.inspectorCount);
          }
          if (typeof a.analystCount === 'number' && a.analystCount >= 1) {
            this.form.controls.analystCount.setValue(a.analystCount);
          }
          if (typeof a.technicianCount === 'number' && a.technicianCount >= 1) {
            this.form.controls.technicianCount.setValue(a.technicianCount);
          }
          this.loadTowers(
            a.regionId,
            a.towers.map((t) => t.towerId),
          );
          this.loadRegionDrones(a.regionId);
        },
        error: () => this.error.set('Không thể tải hồ sơ đánh giá nguồn để sao chép phạm vi.'),
      });
  }

  private initMap(): void {
    const container =
      this.mapContainer()?.nativeElement ??
      (document.getElementById('createScopeMapContainer') as HTMLDivElement | null);
    if (!container) return;

    this.cleanupMap();

    const validTowers = this.getValidTowers();
    const initialMode = resolveLocalMapMode(
      validTowers.map((t) => ({ latitude: t.latitude, longitude: t.longitude })),
      this.currentMapType(),
    );
    this.currentMapType.set(initialMode);
    this.appliedMapMode = initialMode;

    const map = createLocalGisMap(container, {
      mode: initialMode,
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

    this.scheduleMapTask(() => {
      this.map?.resize();
      this.renderMap(true);
    }, 100);
    this.scheduleMapTask(() => this.map?.resize(), 300);
  }

  private renderMap(fit = false): void {
    const validTowers = this.getValidTowers();
    const resolvedMode = resolveLocalMapMode(
      validTowers.map((t) => ({ latitude: t.latitude, longitude: t.longitude })),
      this.currentMapType(),
    );
    if (resolvedMode !== this.currentMapType()) {
      this.currentMapType.set(resolvedMode);
    }

    const selectedIds = this.selectedTowerIds();
    const towerCoords = new Map<string, [number, number]>(
      validTowers.map((t) => [t.id, [t.longitude, t.latitude]]),
    );
    const orderedCoords: [number, number][] = [];
    for (const id of selectedIds) {
      const coords = towerCoords.get(id);
      if (coords) orderedCoords.push(coords);
    }
    this.routeCoords = orderedCoords;

    if (!this.map) return;

    this.applyMapMode(resolvedMode);
    this.clearMarkers();
    setLocalGisRouteLine(this.map, orderedCoords, { color: '#0052cc', width: 3.5 });

    const selectedSet = new Set(selectedIds);
    for (const tower of validTowers) {
      const coords = towerCoords.get(tower.id);
      if (!coords) continue;
      const seq = selectedSet.has(tower.id) ? selectedIds.indexOf(tower.id) + 1 : null;
      const element = this.createTowerMarkerElement(tower, seq);
      const marker = new Marker({ element }).setLngLat(coords).addTo(this.map);
      this.markers.push(marker);
    }

    if (fit) {
      this.fitMapToBounds();
    }
  }

  /** Lọc bỏ an toàn bản ghi tọa độ hỏng (NaN, null, ngoài biên WGS84) để không làm mất các cột hợp lệ. */
  private getValidTowers(): AssessmentTowerOption[] {
    return filterValidCoordinates(this.towers(), (t) => ({
      latitude: t.latitude,
      longitude: t.longitude,
    }));
  }

  private applyMapMode(mode: LocalMapMode): void {
    if (!this.map || this.appliedMapMode === mode) return;
    this.appliedMapMode = mode;
    this.map.setStyle(buildLocalGisStyle(mode));
    // setStyle xóa các layer GeoJSON cũ nên cần gắn lại tuyến bay sau khi style mới nạp xong.
    setLocalGisRouteLine(this.map, this.routeCoords, { color: '#0052cc', width: 3.5 });
  }

  private handleSchematicFallback(): void {
    this.appliedMapMode = 'schematic';
    this.currentMapType.set('schematic');
    if (this.map && this.routeCoords.length > 1) {
      setLocalGisRouteLine(this.map, this.routeCoords, { color: '#0052cc', width: 3.5 });
    }
  }

  private createTowerMarkerElement(tower: AssessmentTowerOption, seq: number | null): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    const meta = tower.poleType ? ` · ${tower.poleType}` : '';
    const label = seq !== null ? `Thứ tự #${seq}: ${tower.towerCode}${meta}` : `${tower.towerCode}${meta}`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.addEventListener('click', () => this.toggleTower(tower.id));

    if (seq !== null) {
      btn.className = 'tower-pin-wrapper';
      const pin = document.createElement('span');
      pin.className = 'evn-tower-pin';
      const numberSpan = document.createElement('span');
      numberSpan.className = 'pin-number';
      numberSpan.textContent = String(seq);
      pin.appendChild(numberSpan);
      btn.appendChild(pin);
      return btn;
    }

    btn.className = 'evn-tower-dot';
    return btn;
  }

  private clearMarkers(): void {
    for (const marker of this.markers) marker.remove();
    this.markers = [];
  }

  private scheduleMapTask(task: () => void, delayMs: number): void {
    const timer = setTimeout(() => {
      this.mapTimers = this.mapTimers.filter((id) => id !== timer);
      task();
    }, delayMs);
    this.mapTimers.push(timer);
  }

  private cleanupMap(): void {
    for (const timer of this.mapTimers) clearTimeout(timer);
    this.mapTimers = [];
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
