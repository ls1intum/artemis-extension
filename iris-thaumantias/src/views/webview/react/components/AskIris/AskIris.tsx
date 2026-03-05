import { Container, Button } from '..';
import styles from './AskIris.module.css';

export interface AskIrisProps {
  description: string;
  onClick: () => void;
}

export function AskIris({ description, onClick }: AskIrisProps) {
  return (
    <Container className={styles.section} header={
      <div className={styles.header}>
        <img
          className={styles.logo}
          src={document.getElementById('root')?.dataset.irisLogoUri}
          alt=""
          width="24"
          height="24"
        />
        <h3>Ask Iris</h3>
      </div>
    }>
      <div className={styles.content}>
        <p>{description}</p>
        <Button variant="primary" onClick={onClick}>Ask</Button>
      </div>
    </Container>
  );
}
