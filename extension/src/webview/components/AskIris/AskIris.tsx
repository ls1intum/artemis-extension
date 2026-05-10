import { Container, Button } from '..';
import styles from './AskIris.module.css';

interface AskIrisProps {
  description: string;
  onClick: () => void;
}

export function AskIris({ description, onClick }: AskIrisProps) {
  return (
    <Container>
      <div className={styles.layout}>
        <div className={styles.logoCol}>
          <img
            className={styles.logo}
            src={document.getElementById('root')?.dataset.irisLogoUri}
            alt=""
          />
        </div>
        <div className={styles.textCol}>
          <h3 className={styles.title}>Ask Iris</h3>
          <p className={styles.description}>{description}</p>
        </div>
        <div className={styles.buttonCol}>
          <Button variant="primary" onClick={onClick}>Ask</Button>
        </div>
      </div>
    </Container>
  );
}
