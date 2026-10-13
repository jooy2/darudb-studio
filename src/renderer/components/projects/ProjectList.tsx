import { useTranslation } from 'react-i18next';
import { CopyCheck, Database, FlaskConical, KeyRound, Pencil, TriangleAlert } from 'lucide-react';
import { PlChip, PlIconButton } from 'plass-ui';
import { formatRelativeTime, splitPath } from '@/renderer/format';
import type { Project } from '@/common/projects';
import type { ProjectView } from '@/common/settings';

interface ProjectListProps {
  projects: readonly Project[];
  view: ProjectView;
  onOpen: (project: Project) => void;
  onEdit: (project: Project) => void;
}

/*
 * The projects, as cards in a grid or as rows: the same items either way,
 * laid out by the stylesheet.
 *
 * Each item is two buttons side by side rather than one inside the other: the
 * item opens the project, and the pencil edits it. A button inside a button is
 * neither to a keyboard or a screen reader.
 * */
export default function ProjectList({ projects, view, onOpen, onEdit }: ProjectListProps) {
  const [t, i18n] = useTranslation();
  const language = i18n.resolvedLanguage ?? 'en';

  return (
    <ul className={`project-list project-list--${view}`} data-testid="project-list">
      {projects.map((project) => {
        const { folder, name: fileName } = splitPath(project.filePath);
        const nameId = `project-${project.id}-name`;
        const detailsId = `project-${project.id}-details`;

        return (
          <li
            key={project.id}
            className={`project${project.missing ? ' project--missing' : ''}`}
            data-testid="project-item"
          >
            <button
              type="button"
              className="project__open"
              data-testid="btn-open-project"
              // Named by the project alone, with the file and its state as the description
              aria-labelledby={nameId}
              aria-describedby={detailsId}
              onClick={() => onOpen(project)}
            >
              <span className="project__icon" aria-hidden="true">
                {project.missing ? <TriangleAlert /> : <Database />}
              </span>
              <span className="project__name" id={nameId}>
                {project.name}
              </span>
              <span className="project__details" id={detailsId}>
                <span className="project__file" title={project.filePath}>
                  <span className="project__file-name">{fileName}</span>
                  {folder && <span className="project__folder">{folder}</span>}
                </span>
                <span className="project__meta">
                  {project.missing && (
                    <PlChip size="xs" color="warning" variant="glass">
                      {t('home.missing')}
                    </PlChip>
                  )}
                  {project.hasPassword && (
                    <PlChip size="xs" variant="glass" startIcon={<KeyRound />}>
                      {t('home.password-saved')}
                    </PlChip>
                  )}
                  {project.sample && (
                    <PlChip size="xs" variant="glass" startIcon={<FlaskConical />}>
                      {t('home.sample')}
                    </PlChip>
                  )}
                  {project.sourcePath !== null && (
                    <PlChip size="xs" variant="glass" startIcon={<CopyCheck />}>
                      {t('home.working-copy')}
                    </PlChip>
                  )}
                  <span className="project__opened">
                    {project.lastOpenedAt === null
                      ? t('home.never-opened')
                      : t('home.opened', {
                          when: formatRelativeTime(project.lastOpenedAt, language),
                        })}
                  </span>
                </span>
              </span>
            </button>
            <PlIconButton
              className="project__edit"
              data-testid="btn-edit-project"
              size="xs"
              variant="ghost"
              label={t('home.edit', { name: project.name })}
              icon={<Pencil />}
              onClick={() => onEdit(project)}
            />
          </li>
        );
      })}
    </ul>
  );
}
