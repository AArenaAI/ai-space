"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTIVE_PROJECT_STORAGE_KEY, ASSET_STORAGE_KEY, PROJECTS_STORAGE_KEY } from "./constants";
import { createSeedreamProject, normalizeProject } from "./projectState";
import type { SeedreamProject } from "./types";

export const SEEDREAM_PROJECTS_CHANGED_EVENT = "seedream-beta-projects-changed";

type ProjectState = {
  projects: SeedreamProject[];
  activeProjectId: string;
};

function normalizeProjects(input: unknown): SeedreamProject[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeProject);
}

function readProjectState(defaultTitle = "新项目"): ProjectState {
  if (typeof window === "undefined") {
    const project = createSeedreamProject(defaultTitle);
    return { projects: [project], activeProjectId: project.id };
  }

  try {
    const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    let projects = normalizeProjects(parsed);

    if (!projects.length) {
      const legacyAssetsRaw = window.localStorage.getItem(ASSET_STORAGE_KEY);
      const legacyAssets = legacyAssetsRaw ? JSON.parse(legacyAssetsRaw) : [];
      projects = [createSeedreamProject(defaultTitle, Array.isArray(legacyAssets) ? legacyAssets : [])].map(normalizeProject);
      window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
    }

    const storedActiveId = window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) || "";
    const activeProjectId = projects.some((project) => project.id === storedActiveId) ? storedActiveId : projects[0]?.id || "";
    if (activeProjectId) window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeProjectId);
    return { projects, activeProjectId };
  } catch {
    const project = createSeedreamProject(defaultTitle);
    return { projects: [project], activeProjectId: project.id };
  }
}

function emitProjectChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SEEDREAM_PROJECTS_CHANGED_EVENT));
}

function persistProjects(projects: SeedreamProject[], activeProjectId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  if (activeProjectId) window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeProjectId);
  else window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
  emitProjectChange();
}

export function useSeedreamProjects(defaultTitle = "新项目") {
  const initial = useMemo(() => readProjectState(defaultTitle), [defaultTitle]);
  const [projects, setProjectsState] = useState<SeedreamProject[]>(initial.projects);
  const [activeProjectId, setActiveProjectIdState] = useState(initial.activeProjectId);
  const activeProjectIdRef = useRef(initial.activeProjectId);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  const reload = useCallback(() => {
    const next = readProjectState(defaultTitle);
    setProjectsState(next.projects);
    setActiveProjectIdState(next.activeProjectId);
    activeProjectIdRef.current = next.activeProjectId;
  }, [defaultTitle]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === PROJECTS_STORAGE_KEY || event.key === ACTIVE_PROJECT_STORAGE_KEY) reload();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(SEEDREAM_PROJECTS_CHANGED_EVENT, reload);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(SEEDREAM_PROJECTS_CHANGED_EVENT, reload);
    };
  }, [reload]);

  const setProjects = useCallback((updater: SeedreamProject[] | ((prev: SeedreamProject[]) => SeedreamProject[])) => {
    setProjectsState((prev) => {
      const nextRaw = typeof updater === "function" ? updater(prev) : updater;
      const next = normalizeProjects(nextRaw);
      let nextActiveId = activeProjectIdRef.current;
      if (!next.some((project) => project.id === nextActiveId)) nextActiveId = next[0]?.id || "";
      setActiveProjectIdState(nextActiveId);
      activeProjectIdRef.current = nextActiveId;
      persistProjects(next, nextActiveId);
      return next;
    });
  }, []);

  const setActiveProjectId = useCallback((projectId: string) => {
    activeProjectIdRef.current = projectId;
    setActiveProjectIdState(projectId);
    persistProjects(projects, projectId);
  }, [projects]);

  const createProject = useCallback((title?: string) => {
    const project = createSeedreamProject(title || defaultTitle);
    const next = [project, ...projects];
    setProjectsState(next);
    setActiveProjectIdState(project.id);
    activeProjectIdRef.current = project.id;
    persistProjects(next, project.id);
    return project;
  }, [defaultTitle, projects]);

  const deleteProject = useCallback((projectId: string) => {
    const next = projects.filter((project) => project.id !== projectId);
    const nextActiveId = activeProjectIdRef.current === projectId ? next[0]?.id || "" : activeProjectIdRef.current;
    setProjectsState(next);
    setActiveProjectIdState(nextActiveId);
    activeProjectIdRef.current = nextActiveId;
    persistProjects(next, nextActiveId);
  }, [projects]);

  const renameProject = useCallback((projectId: string, title: string) => {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    const next = projects.map((project) => project.id === projectId ? { ...project, title: cleanTitle, updatedAt: new Date().toISOString() } : project);
    setProjectsState(next);
    persistProjects(next, activeProjectIdRef.current);
  }, [projects]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || projects[0],
    [projects, activeProjectId]
  );

  return {
    projects,
    setProjects,
    activeProjectId,
    setActiveProjectId,
    activeProject,
    createProject,
    deleteProject,
    renameProject,
    reload,
  };
}

export function getSeedreamProjectSnapshot(defaultTitle = "新项目") {
  return readProjectState(defaultTitle);
}

export function notifySeedreamProjectsChanged() {
  emitProjectChange();
}
